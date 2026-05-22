import { geohashForBoundsCenter } from "./geohash.js";
import { FULL_GEOHASH_PRECISION } from "./levels.js";

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

export class DistrictLayoutEngine {
  assignAddress(target) {
    target.bounds = roundBounds(target.bounds);
    target.geo = geohashForBoundsCenter(target.bounds, FULL_GEOHASH_PRECISION);
  }

  layoutChildren(children, bounds, { reserveGrowth = true, root = false } = {}) {
    if (children.length === 0) {
      return { growthArea: roundBounds(bounds) };
    }

    const baseBounds = root ? insetBounds(bounds, ROOT_MARGIN) : insetByRatio(bounds, INNER_PADDING_RATIO, INNER_PADDING_MAX);
    const { childBounds, growthArea } = reserveGrowth ? this.reserveGrowthArea(baseBounds, GROWTH_FRACTION) : { childBounds: baseBounds, growthArea: baseBounds };
    this.layoutInto(children, childBounds, growthArea);
    return { growthArea: roundBounds(growthArea) };
  }

  placeChildrenInGrowth(children, bounds) {
    if (children.length === 0) return { growthArea: roundBounds(bounds) };
    const { childBounds, growthArea } = this.reserveGrowthArea(bounds, NEXT_GROWTH_FRACTION);
    this.layoutInto(children, childBounds, growthArea);
    return { growthArea: roundBounds(growthArea) };
  }

  nextGrowthArea(bounds) {
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

  layoutInto(children, childBounds, fallbackBounds) {
    const contentBounds = insetByRatio(childBounds, INNER_PADDING_RATIO, INNER_PADDING_MAX);
    const gutter = gutterFor(contentBounds, children.length);
    const ordered = this.orderedForLayout(children);
    const rectangles = this.layoutRectangles(ordered, contentBounds, fallbackBounds);

    for (const { item, bounds: childBounds } of rectangles) {
      item.bounds = roundBounds(insetBounds(childBounds, gutter / 2));
    }
  }

  orderedForLayout(children) {
    return [...children].sort((a, b) => {
      const typeDelta = this.typeRank(a) - this.typeRank(b);
      if (typeDelta !== 0) return typeDelta;
      const weightDelta = this.layoutWeight(b) - this.layoutWeight(a);
      if (Math.abs(weightDelta) > 1e-9) return weightDelta;
      return a.path.localeCompare(b.path);
    });
  }

  layoutWeight(child) {
    const size = Math.sqrt(Math.max(1, child.weight || child.lineCount || 1));
    const childCount = child.type === "folder" ? child.folders.size + child.files.size : 0;
    const structure = child.type === "folder" ? Math.log2(childCount + 2) : 0;
    return Math.max(MIN_LAYOUT_WEIGHT, size + structure);
  }

  typeRank(child) {
    return child.type === "folder" ? 0 : 1;
  }

  layoutRectangles(children, preferredBounds, fallbackBounds) {
    const bounds = hasUsableArea(preferredBounds) ? preferredBounds : fallbackBounds;
    if (!hasUsableArea(bounds)) {
      const rectangles = [];
      for (const item of children) rectangles.push({ item, bounds });
      return rectangles;
    }

    const entries = [];
    for (const item of children) entries.push({ item, weight: this.layoutWeight(item) });
    const rectangles = this.binaryPartition(entries, bounds);
    return rectangles.length === children.length ? rectangles : this.stripLayout(children, bounds);
  }

  binaryPartition(entries, bounds, rectangles = []) {
    return this.binaryPartitionRange(entries, 0, entries.length, bounds, this.prefixWeights(entries), rectangles);
  }

  binaryPartitionRange(entries, start, end, bounds, prefixWeights, rectangles) {
    const count = end - start;
    if (count === 0) return rectangles;
    if (count === 1) {
      rectangles.push({ item: entries[start].item, bounds });
      return rectangles;
    }

    const split = this.splitEntryRange(entries, start, end, prefixWeights);
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

  splitEntries(entries) {
    const split = this.splitEntryRange(entries, 0, entries.length, this.prefixWeights(entries));
    return {
      first: entries.slice(0, split),
      second: entries.slice(split),
    };
  }

  splitEntryRange(entries, start, end, prefixWeights) {
    const totalWeight = this.rangeWeight(prefixWeights, start, end);
    let bestIndex = 1;
    let bestDelta = Infinity;
    let runningWeight = 0;

    for (let index = start; index < end - 1; index += 1) {
      runningWeight += entries[index].weight;
      const delta = Math.abs(totalWeight / 2 - runningWeight);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestIndex = index + 1 - start;
      }
    }

    return start + bestIndex;
  }

  prefixWeights(entries) {
    const prefixWeights = [0];
    for (const entry of entries) prefixWeights.push(prefixWeights[prefixWeights.length - 1] + entry.weight);
    return prefixWeights;
  }

  rangeWeight(prefixWeights, start, end) {
    return prefixWeights[end] - prefixWeights[start];
  }

  stripLayout(children, bounds) {
    let totalWeight = 0;
    for (const child of children) totalWeight += this.layoutWeight(child);
    const horizontal = bounds.width >= bounds.height;
    let cursor = horizontal ? bounds.x : bounds.y;
    const rectangles = [];

    for (let index = 0; index < children.length; index += 1) {
      const item = children[index];
      const isLast = index === children.length - 1;
      const span = isLast
        ? (horizontal ? bounds.x + bounds.width : bounds.y + bounds.height) - cursor
        : ((horizontal ? bounds.width : bounds.height) * this.layoutWeight(item)) / totalWeight;
      const childBounds = horizontal
        ? { x: cursor, y: bounds.y, width: span, height: bounds.height }
        : { x: bounds.x, y: cursor, width: bounds.width, height: span };
      cursor += span;
      rectangles.push({ item, bounds: childBounds });
    }

    return rectangles;
  }

  reserveGrowthArea(bounds, fraction) {
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

export function assignAddress(target) {
  DISTRICT_LAYOUT_ENGINE.assignAddress(target);
}

export function layoutChildren(children, bounds, { reserveGrowth = true, root = false } = {}) {
  return DISTRICT_LAYOUT_ENGINE.layoutChildren(children, bounds, { reserveGrowth, root });
}

export function placeChildrenInGrowth(children, bounds) {
  return DISTRICT_LAYOUT_ENGINE.placeChildrenInGrowth(children, bounds);
}

export function nextGrowthArea(bounds) {
  return DISTRICT_LAYOUT_ENGINE.nextGrowthArea(bounds);
}

export function roundBounds(bounds) {
  return {
    x: round(bounds.x),
    y: round(bounds.y),
    width: round(Math.max(0, bounds.width)),
    height: round(Math.max(0, bounds.height)),
  };
}

function insetByRatio(bounds, ratio, maxInset) {
  return insetBounds(bounds, Math.min(maxInset, Math.min(bounds.width, bounds.height) * ratio));
}

function insetBounds(bounds, inset) {
  const safeInset = Math.min(inset, bounds.width / 2, bounds.height / 2);
  return {
    x: bounds.x + safeInset,
    y: bounds.y + safeInset,
    width: Math.max(0, bounds.width - safeInset * 2),
    height: Math.max(0, bounds.height - safeInset * 2),
  };
}

function gutterFor(bounds, childCount) {
  if (childCount <= 1) return 0;
  return Math.min(GUTTER_MAX, Math.min(bounds.width, bounds.height) * GUTTER_RATIO);
}

function hasUsableArea(bounds) {
  return bounds.width > MIN_USABLE_SIDE && bounds.height > MIN_USABLE_SIDE;
}

function round(value) {
  return Number(value.toFixed(12));
}
