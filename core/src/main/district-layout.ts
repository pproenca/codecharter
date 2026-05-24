/**
 * District (treemap-style) layout — a recursive weight-balanced **binary
 * partition** with reserved growth space.
 *
 * Implements **BR-007** (sqrt + structural-floor layout weight), **BR-008**
 * (binary weight-balanced partition + strip fallback), **BR-009** (deterministic
 * folders-first ordering), **BR-010** (padding/gutter/growth constants).
 *
 * NOTE: despite the "treemap" framing elsewhere, there is NO squarified
 * aspect-ratio logic — the split axis simply follows the longer side. The local
 * `roundBounds` here floors width/height at 0 (the BR-004 divergence from
 * `geometry.roundBounds`). The legacy `DistrictLayoutEngine` wrapper class was a
 * test-only surface and is dropped in favor of the free functions.
 */

import { geohashForBoundsCenter } from "./geohash.ts";
import { FULL_GEOHASH_PRECISION } from "./levels.ts";
import { round } from "./math.ts";
import { sortIfNeeded } from "./collections.ts";
import type { Bounds } from "./geometry.ts";
import type { GeohashedCoordinate } from "./geo-types.ts";

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

/** Round bounds, then assign the target's geohash address from its center (BR-001). */
export function assignAddress(target: LayoutTarget): void {
  if (!target.bounds) {
    throw new Error(`Cannot assign address without bounds: ${target.path}`);
  }
  target.bounds = roundBounds(target.bounds);
  target.geo = geohashForBoundsCenter(target.bounds, FULL_GEOHASH_PRECISION);
}

/** Lay children into a rectangle, reserving growth space; mutates each child's bounds. */
export function layoutChildren(
  children: LayoutTarget[],
  bounds: Bounds,
  { reserveGrowth = true, root = false }: LayoutOptions = {},
): GrowthLayoutResult {
  if (children.length === 0) {
    return { growthArea: roundBounds(bounds) };
  }

  const baseBounds = root
    ? insetBounds(bounds, ROOT_MARGIN)
    : insetByRatio(bounds, INNER_PADDING_RATIO, INNER_PADDING_MAX);
  const { childBounds, growthArea } = reserveGrowth
    ? reserveGrowthArea(baseBounds, GROWTH_FRACTION)
    : { childBounds: baseBounds, growthArea: baseBounds };
  layoutInto(children, childBounds, growthArea);
  return { growthArea: roundBounds(growthArea) };
}

/** Place newly-added children into a folder's reserved growth area. */
export function placeChildrenInGrowth(
  children: LayoutTarget[],
  bounds: Bounds,
): GrowthLayoutResult {
  if (children.length === 0) {
    return { growthArea: roundBounds(bounds) };
  }
  const { childBounds, growthArea } = reserveGrowthArea(bounds, NEXT_GROWTH_FRACTION);
  layoutInto(children, childBounds, growthArea);
  return { growthArea: roundBounds(growthArea) };
}

/** The next growth area after consuming part of the current one (BR-010). */
export function nextGrowthArea(bounds: Bounds): Bounds {
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

/** Round bounds, flooring width/height at 0 (BR-004; floors, unlike geometry.roundBounds). */
export function roundBounds(bounds: Bounds): Bounds {
  return {
    x: round(bounds.x),
    y: round(bounds.y),
    width: round(Math.max(0, bounds.width)),
    height: round(Math.max(0, bounds.height)),
  };
}

function layoutInto(children: LayoutTarget[], childBounds: Bounds, fallbackBounds: Bounds): void {
  const contentBounds = insetByRatio(childBounds, INNER_PADDING_RATIO, INNER_PADDING_MAX);
  const gutter = gutterFor(contentBounds, children.length);
  const ordered = orderedForLayout(children);
  const rectangles = layoutRectangles(ordered, contentBounds, fallbackBounds);

  for (const { item, bounds } of rectangles) {
    item.bounds = roundBounds(insetBounds(bounds, gutter / 2));
  }
}

function orderedForLayout(children: LayoutTarget[]): LayoutTarget[] {
  const ordered = children.map((child) => ({
    child,
    typeRank: typeRank(child),
    layoutWeight: layoutWeight(child),
  }));
  return sortIfNeeded(ordered, compareLayoutEntries).map((entry) => entry.child);
}

function layoutWeight(child: LayoutTarget): number {
  const size = Math.sqrt(Math.max(1, child.weight || child.lineCount || 1));
  const childCount =
    child.type === "folder" ? (child.folders?.size ?? 0) + (child.files?.size ?? 0) : 0;
  const structure = child.type === "folder" ? Math.log2(childCount + 2) : 0;
  return Math.max(MIN_LAYOUT_WEIGHT, size + structure);
}

function typeRank(child: LayoutTarget): number {
  return child.type === "folder" ? 0 : 1;
}

function layoutRectangles(
  children: LayoutTarget[],
  preferredBounds: Bounds,
  fallbackBounds: Bounds,
): LayoutRectangle[] {
  const bounds = hasUsableArea(preferredBounds) ? preferredBounds : fallbackBounds;
  if (!hasUsableArea(bounds)) {
    return children.map((item) => ({ item, bounds }));
  }

  const entries = children.map((item) => ({ item, weight: layoutWeight(item) }));
  const rectangles = binaryPartition(entries, bounds);
  return rectangles.length === children.length ? rectangles : stripLayout(children, bounds);
}

function binaryPartition(
  entries: WeightedEntry[],
  bounds: Bounds,
  rectangles: LayoutRectangle[] = [],
): LayoutRectangle[] {
  return binaryPartitionRange(
    entries,
    0,
    entries.length,
    bounds,
    prefixWeights(entries),
    rectangles,
  );
}

function binaryPartitionRange(
  entries: WeightedEntry[],
  start: number,
  end: number,
  bounds: Bounds,
  prefixes: number[],
  rectangles: LayoutRectangle[],
): LayoutRectangle[] {
  const count = end - start;
  if (count === 0) {
    return rectangles;
  }
  if (count === 1) {
    const entry = entries[start];
    if (!entry) {
      return rectangles;
    }
    rectangles.push({ item: entry.item, bounds });
    return rectangles;
  }

  const split = splitEntryRange(start, end, prefixes);
  const firstWeight = rangeWeight(prefixes, start, split);
  const totalWeight = rangeWeight(prefixes, start, end);
  const ratio = totalWeight > 0 ? firstWeight / totalWeight : 0.5;

  if (bounds.width >= bounds.height) {
    const firstWidth = bounds.width * ratio;
    binaryPartitionRange(
      entries,
      start,
      split,
      { x: bounds.x, y: bounds.y, width: firstWidth, height: bounds.height },
      prefixes,
      rectangles,
    );
    return binaryPartitionRange(
      entries,
      split,
      end,
      {
        x: bounds.x + firstWidth,
        y: bounds.y,
        width: bounds.width - firstWidth,
        height: bounds.height,
      },
      prefixes,
      rectangles,
    );
  }

  const firstHeight = bounds.height * ratio;
  binaryPartitionRange(
    entries,
    start,
    split,
    { x: bounds.x, y: bounds.y, width: bounds.width, height: firstHeight },
    prefixes,
    rectangles,
  );
  return binaryPartitionRange(
    entries,
    split,
    end,
    {
      x: bounds.x,
      y: bounds.y + firstHeight,
      width: bounds.width,
      height: bounds.height - firstHeight,
    },
    prefixes,
    rectangles,
  );
}

function splitEntryRange(start: number, end: number, prefixes: number[]): number {
  const totalWeight = rangeWeight(prefixes, start, end);
  const targetWeight = (prefixes[start] ?? 0) + totalWeight / 2;
  const candidate = firstSplitAtOrAfterWeight(prefixes, start + 1, end - 1, targetWeight);
  const previous = candidate > start + 1 ? candidate - 1 : candidate;
  const candidateDelta = Math.abs(totalWeight / 2 - rangeWeight(prefixes, start, candidate));
  const previousDelta = Math.abs(totalWeight / 2 - rangeWeight(prefixes, start, previous));
  return previousDelta <= candidateDelta ? previous : candidate;
}

function firstSplitAtOrAfterWeight(
  prefixes: number[],
  low: number,
  high: number,
  targetWeight: number,
): number {
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (prefixes[mid]! < targetWeight) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function prefixWeights(entries: { weight: number }[]): number[] {
  const prefixes = [0];
  for (const entry of entries) {
    prefixes.push(prefixes[prefixes.length - 1]! + entry.weight);
  }
  return prefixes;
}

function rangeWeight(prefixes: number[], start: number, end: number): number {
  return prefixes[end]! - prefixes[start]!;
}

function stripLayout(children: LayoutTarget[], bounds: Bounds): LayoutRectangle[] {
  const weighted = children.map((child) => ({ child, weight: layoutWeight(child) }));
  const totalWeight = weighted.reduce((sum, { weight }) => sum + weight, 0);
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

function reserveGrowthArea(bounds: Bounds, fraction: number): ReservedGrowthArea {
  const horizontal = bounds.width >= bounds.height;
  if (horizontal) {
    const growthWidth = bounds.width * fraction;
    return {
      childBounds: {
        x: bounds.x,
        y: bounds.y,
        width: Math.max(0, bounds.width - growthWidth),
        height: bounds.height,
      },
      growthArea: {
        x: bounds.x + bounds.width - growthWidth,
        y: bounds.y,
        width: growthWidth,
        height: bounds.height,
      },
    };
  }

  const growthHeight = bounds.height * fraction;
  return {
    childBounds: {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: Math.max(0, bounds.height - growthHeight),
    },
    growthArea: {
      x: bounds.x,
      y: bounds.y + bounds.height - growthHeight,
      width: bounds.width,
      height: growthHeight,
    },
  };
}

function compareLayoutEntries(a: LayoutEntry, b: LayoutEntry): number {
  const typeDelta = a.typeRank - b.typeRank;
  if (typeDelta !== 0) {
    return typeDelta;
  }
  const weightDelta = b.layoutWeight - a.layoutWeight;
  if (Math.abs(weightDelta) > 1e-9) {
    return weightDelta;
  }
  return a.child.path.localeCompare(b.child.path);
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
  if (childCount <= 1) {
    return 0;
  }
  return Math.min(GUTTER_MAX, Math.min(bounds.width, bounds.height) * GUTTER_RATIO);
}

function hasUsableArea(bounds: Bounds): boolean {
  return bounds.width > MIN_USABLE_SIDE && bounds.height > MIN_USABLE_SIDE;
}
