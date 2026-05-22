import { geohashForBoundsCenter } from "./geohash.ts";
import { FULL_GEOHASH_PRECISION } from "./levels.ts";
import type { Bounds } from "./geometry.js";
import type { GeohashedCoordinate } from "./geohash.js";

export const PROJECTION_TYPE = "filesystem-district-map";
export const PROJECTION_LAYOUT_VERSION = 3;
export const PROJECTION_ORDER = "bounded-weight-binary-districts-folders-first";
export const PROJECTION_AREA_WEIGHT = "sqrt-token-count-with-structural-floor";

const ROOT_MARGIN = 0.012;
const INNER_PADDING_RATIO = 0.035;
const INNER_PADDING_MAX = 0.012;
const GUTTER_RATIO = 0.018;
const GUTTER_MAX = 0.008;
const GROWTH_FRACTION = 0.06;
const NEXT_GROWTH_FRACTION = 0.2;
const MIN_LAYOUT_WEIGHT = 2;
const MIN_USABLE_SIDE = 1e-9;

export type LayoutTarget = {
  type: "file" | "folder";
  path: string;
  weight?: number;
  lineCount?: number;
  folders?: Map<string, unknown>;
  files?: Map<string, unknown>;
  bounds?: Bounds;
  geo?: GeohashedCoordinate;
};

export type LayoutOptions = {
  reserveGrowth?: boolean;
  root?: boolean;
};

export type GrowthLayoutResult = {
  growthArea: Bounds;
};

type ReservedGrowthArea = {
  childBounds: Bounds;
  growthArea: Bounds;
};

type LayoutEntry = {
  child: LayoutTarget;
  typeRank: number;
  layoutWeight: number;
};

type WeightedEntry = {
  item: LayoutTarget;
  weight: number;
};

type LayoutRectangle = {
  item: LayoutTarget;
  bounds: Bounds;
};

export class DistrictLayoutEngine {
  assignAddress(target: LayoutTarget): void {
    if (!target.bounds) throw new Error(`Cannot assign address without bounds: ${target.path}`);
    target.bounds = roundBounds(target.bounds);
    target.geo = geohashForBoundsCenter(target.bounds, FULL_GEOHASH_PRECISION);
  }

  layoutChildren(children: LayoutTarget[], bounds: Bounds, { reserveGrowth = true, root = false }: LayoutOptions = {}): GrowthLayoutResult {
    if (children.length === 0) {
      return { growthArea: roundBounds(bounds) };
    }

    const baseBounds = root ? insetBounds(bounds, ROOT_MARGIN) : insetByRatio(bounds, INNER_PADDING_RATIO, INNER_PADDING_MAX);
    const { childBounds, growthArea } = reserveGrowth ? this.reserveGrowthArea(baseBounds, GROWTH_FRACTION) : { childBounds: baseBounds, growthArea: baseBounds };
    this.layoutInto(children, childBounds, growthArea);
    return { growthArea: roundBounds(growthArea) };
  }

  placeChildrenInGrowth(children: LayoutTarget[], bounds: Bounds): GrowthLayoutResult {
    if (children.length === 0) return { growthArea: roundBounds(bounds) };
    const { childBounds, growthArea } = this.reserveGrowthArea(bounds, NEXT_GROWTH_FRACTION);
    this.layoutInto(children, childBounds, growthArea);
    return { growthArea: roundBounds(growthArea) };
  }

  nextGrowthArea(bounds: Bounds): Bounds {
    const horizontal = bounds.width >= bounds.height;
    if (horizontal) {
      const width = bounds.width * NEXT_GROWTH_FRACTION;
      return roundBounds({
        x: bounds.x + bounds.width - width,
        y: bounds.y,
        width,
        height: bounds.height,
      });
    }

    const height = bounds.height * NEXT_GROWTH_FRACTION;
    return roundBounds({
      x: bounds.x,
      y: bounds.y + bounds.height - height,
      width: bounds.width,
      height,
    });
  }

  layoutInto(children: LayoutTarget[], childBounds: Bounds, fallbackBounds: Bounds): void {
    const contentBounds = insetByRatio(childBounds, INNER_PADDING_RATIO, INNER_PADDING_MAX);
    const gutter = gutterFor(contentBounds, children.length);
    const ordered = this.orderedForLayout(children);
    const rectangles = this.layoutRectangles(ordered, contentBounds, fallbackBounds);

    for (const { item, bounds: childBounds } of rectangles) {
      item.bounds = roundBounds(insetBounds(childBounds, gutter / 2));
    }
  }

  orderedForLayout(children: LayoutTarget[]): LayoutTarget[] {
    const ordered: LayoutEntry[] = [];
    for (const child of children) {
      ordered.push({
        child,
        typeRank: this.typeRank(child),
        layoutWeight: this.layoutWeight(child),
      });
    }
    if (!layoutEntriesAreSorted(ordered)) ordered.sort(compareLayoutEntries);
    const childrenForLayout: LayoutTarget[] = [];
    for (const entry of ordered) childrenForLayout.push(entry.child);
    return childrenForLayout;
  }

  layoutWeight(child: LayoutTarget): number {
    const size = Math.sqrt(Math.max(1, child.weight || child.lineCount || 1));
    const childCount = child.type === "folder" ? (child.folders?.size ?? 0) + (child.files?.size ?? 0) : 0;
    const structure = child.type === "folder" ? Math.log2(childCount + 2) : 0;
    return Math.max(MIN_LAYOUT_WEIGHT, size + structure);
  }

  typeRank(child: LayoutTarget): number {
    return child.type === "folder" ? 0 : 1;
  }

  layoutRectangles(children: LayoutTarget[], preferredBounds: Bounds, fallbackBounds: Bounds): LayoutRectangle[] {
    const bounds = hasUsableArea(preferredBounds) ? preferredBounds : fallbackBounds;
    if (!hasUsableArea(bounds)) {
      const rectangles: LayoutRectangle[] = [];
      for (const item of children) rectangles.push({ item, bounds });
      return rectangles;
    }

    const entries: WeightedEntry[] = [];
    for (const item of children) entries.push({ item, weight: this.layoutWeight(item) });
    const rectangles = this.binaryPartition(entries, bounds);
    return rectangles.length === children.length ? rectangles : this.stripLayout(children, bounds);
  }

  binaryPartition(entries: WeightedEntry[], bounds: Bounds, rectangles: LayoutRectangle[] = []): LayoutRectangle[] {
    return this.binaryPartitionRange(entries, 0, entries.length, bounds, this.prefixWeights(entries), rectangles);
  }

  binaryPartitionRange(
    entries: WeightedEntry[],
    start: number,
    end: number,
    bounds: Bounds,
    prefixWeights: number[],
    rectangles: LayoutRectangle[],
  ): LayoutRectangle[] {
    const count = end - start;
    if (count === 0) return rectangles;
    if (count === 1) {
      rectangles.push({ item: entries[start]!.item, bounds });
      return rectangles;
    }

    const split = this.splitEntryRange(start, end, prefixWeights);
    const firstWeight = this.rangeWeight(prefixWeights, start, split);
    const totalWeight = this.rangeWeight(prefixWeights, start, end);
    const ratio = totalWeight > 0 ? firstWeight / totalWeight : 0.5;

    if (bounds.width >= bounds.height) {
      const firstWidth = bounds.width * ratio;
      this.binaryPartitionRange(entries, start, split, { x: bounds.x, y: bounds.y, width: firstWidth, height: bounds.height }, prefixWeights, rectangles);
      return this.binaryPartitionRange(entries, split, end, { x: bounds.x + firstWidth, y: bounds.y, width: bounds.width - firstWidth, height: bounds.height }, prefixWeights, rectangles);
    }

    const firstHeight = bounds.height * ratio;
    this.binaryPartitionRange(entries, start, split, { x: bounds.x, y: bounds.y, width: bounds.width, height: firstHeight }, prefixWeights, rectangles);
    return this.binaryPartitionRange(entries, split, end, { x: bounds.x, y: bounds.y + firstHeight, width: bounds.width, height: bounds.height - firstHeight }, prefixWeights, rectangles);
  }

  splitEntries<T extends WeightedEntry>(entries: T[]): { first: T[]; second: T[] } {
    const split = this.splitEntryRange(0, entries.length, this.prefixWeights(entries));
    const first: T[] = [];
    const second: T[] = [];
    for (let index = 0; index < entries.length; index += 1) {
      if (index < split) {
        first.push(entries[index]);
      } else {
        second.push(entries[index]);
      }
    }
    return {
      first,
      second,
    };
  }

  splitEntryRange(start: number, end: number, prefixWeights: number[]): number {
    const totalWeight = this.rangeWeight(prefixWeights, start, end);
    const targetWeight = prefixWeights[start] + totalWeight / 2;
    const candidate = this.firstSplitAtOrAfterWeight(prefixWeights, start + 1, end - 1, targetWeight);
    const previous = candidate > start + 1 ? candidate - 1 : candidate;
    const candidateDelta = Math.abs(totalWeight / 2 - this.rangeWeight(prefixWeights, start, candidate));
    const previousDelta = Math.abs(totalWeight / 2 - this.rangeWeight(prefixWeights, start, previous));
    return previousDelta <= candidateDelta ? previous : candidate;
  }

  firstSplitAtOrAfterWeight(prefixWeights: number[], low: number, high: number, targetWeight: number): number {
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (prefixWeights[mid]! < targetWeight) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  }

  prefixWeights(entries: { weight: number }[]): number[] {
    const prefixWeights = [0];
    for (const entry of entries) prefixWeights.push(prefixWeights[prefixWeights.length - 1]! + entry.weight);
    return prefixWeights;
  }

  rangeWeight(prefixWeights: number[], start: number, end: number): number {
    return prefixWeights[end]! - prefixWeights[start]!;
  }

  stripLayout(children: LayoutTarget[], bounds: Bounds): LayoutRectangle[] {
    let totalWeight = 0;
    const weighted: Array<{ child: LayoutTarget; weight: number }> = [];
    for (const child of children) {
      const weight = this.layoutWeight(child);
      totalWeight += weight;
      weighted.push({ child, weight });
    }
    const horizontal = bounds.width >= bounds.height;
    let cursor = horizontal ? bounds.x : bounds.y;
    const rectangles: LayoutRectangle[] = [];

    for (let index = 0; index < weighted.length; index += 1) {
      const { child, weight } = weighted[index]!;
      const isLast = index === weighted.length - 1;
      const span = isLast
        ? (horizontal ? bounds.x + bounds.width : bounds.y + bounds.height) - cursor
        : ((horizontal ? bounds.width : bounds.height) * weight) / totalWeight;
      const childBounds = horizontal
        ? { x: cursor, y: bounds.y, width: span, height: bounds.height }
        : { x: bounds.x, y: cursor, width: bounds.width, height: span };
      cursor += span;
      rectangles.push({ item: child, bounds: childBounds });
    }

    return rectangles;
  }

  reserveGrowthArea(bounds: Bounds, fraction: number): ReservedGrowthArea {
    const horizontal = bounds.width >= bounds.height;
    if (horizontal) {
      const growthWidth = bounds.width * fraction;
      return {
        childBounds: { x: bounds.x, y: bounds.y, width: Math.max(0, bounds.width - growthWidth), height: bounds.height },
        growthArea: { x: bounds.x + bounds.width - growthWidth, y: bounds.y, width: growthWidth, height: bounds.height },
      };
    }

    const growthHeight = bounds.height * fraction;
    return {
      childBounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: Math.max(0, bounds.height - growthHeight) },
      growthArea: { x: bounds.x, y: bounds.y + bounds.height - growthHeight, width: bounds.width, height: growthHeight },
    };
  }
}

const DISTRICT_LAYOUT_ENGINE = new DistrictLayoutEngine();

function layoutEntriesAreSorted(entries: LayoutEntry[]): boolean {
  for (let index = 1; index < entries.length; index += 1) {
    if (compareLayoutEntries(entries[index - 1], entries[index]) > 0) return false;
  }
  return true;
}

function compareLayoutEntries(a: LayoutEntry, b: LayoutEntry): number {
  const typeDelta = a.typeRank - b.typeRank;
  if (typeDelta !== 0) return typeDelta;
  const weightDelta = b.layoutWeight - a.layoutWeight;
  if (Math.abs(weightDelta) > 1e-9) return weightDelta;
  return a.child.path.localeCompare(b.child.path);
}

export function assignAddress(target: LayoutTarget): void {
  DISTRICT_LAYOUT_ENGINE.assignAddress(target);
}

export function layoutChildren(children: LayoutTarget[], bounds: Bounds, { reserveGrowth = true, root = false }: LayoutOptions = {}): GrowthLayoutResult {
  return DISTRICT_LAYOUT_ENGINE.layoutChildren(children, bounds, { reserveGrowth, root });
}

export function placeChildrenInGrowth(children: LayoutTarget[], bounds: Bounds): GrowthLayoutResult {
  return DISTRICT_LAYOUT_ENGINE.placeChildrenInGrowth(children, bounds);
}

export function nextGrowthArea(bounds: Bounds): Bounds {
  return DISTRICT_LAYOUT_ENGINE.nextGrowthArea(bounds);
}

export function roundBounds(bounds: Bounds): Bounds {
  return {
    x: round(bounds.x),
    y: round(bounds.y),
    width: round(Math.max(0, bounds.width)),
    height: round(Math.max(0, bounds.height)),
  };
}

function insetByRatio(bounds: Bounds, ratio: number, maxInset: number): Bounds {
  return insetBounds(bounds, Math.min(maxInset, Math.min(bounds.width, bounds.height) * ratio));
}

function insetBounds(bounds: Bounds, inset: number): Bounds {
  const safeInset = Math.min(inset, bounds.width / 2, bounds.height / 2);
  return {
    x: bounds.x + safeInset,
    y: bounds.y + safeInset,
    width: Math.max(0, bounds.width - safeInset * 2),
    height: Math.max(0, bounds.height - safeInset * 2),
  };
}

function gutterFor(bounds: Bounds, childCount: number): number {
  if (childCount <= 1) return 0;
  return Math.min(GUTTER_MAX, Math.min(bounds.width, bounds.height) * GUTTER_RATIO);
}

function hasUsableArea(bounds: Bounds): boolean {
  return bounds.width > MIN_USABLE_SIDE && bounds.height > MIN_USABLE_SIDE;
}

function round(value: number): number {
  return Number(value.toFixed(12));
}
