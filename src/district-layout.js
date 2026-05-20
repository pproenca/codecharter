import { geohashForBoundsCenter } from "./geohash.js";
import { FULL_GEOHASH_PRECISION } from "./levels.js";

export const PROJECTION_TYPE = "filesystem-district-map";
export const PROJECTION_ORDER = "bounded-weight-squarified-folders-first";
export const PROJECTION_AREA_WEIGHT = "sqrt-line-count-with-structural-floor";

const ROOT_MARGIN = 0.012;
const INNER_PADDING_RATIO = 0.035;
const INNER_PADDING_MAX = 0.012;
const GUTTER_RATIO = 0.018;
const GUTTER_MAX = 0.008;
const GROWTH_FRACTION = 0.06;
const NEXT_GROWTH_FRACTION = 0.2;
const MIN_LAYOUT_WEIGHT = 2;
const MIN_USABLE_SIDE = 1e-9;

export function assignAddress(target) {
  target.bounds = roundBounds(target.bounds);
  target.geo = geohashForBoundsCenter(target.bounds, FULL_GEOHASH_PRECISION);
}

export function layoutChildren(children, bounds, { reserveGrowth = true, root = false } = {}) {
  if (children.length === 0) {
    return { growthArea: roundBounds(bounds) };
  }

  const baseBounds = root ? insetBounds(bounds, ROOT_MARGIN) : insetByRatio(bounds, INNER_PADDING_RATIO, INNER_PADDING_MAX);
  const { childBounds, growthArea } = reserveGrowth ? reserveGrowthArea(baseBounds, GROWTH_FRACTION) : { childBounds: baseBounds, growthArea: baseBounds };
  const contentBounds = insetByRatio(childBounds, INNER_PADDING_RATIO, INNER_PADDING_MAX);
  const gutter = gutterFor(contentBounds, children.length);
  const ordered = orderedForLayout(children);
  const rectangles = layoutRectangles(ordered, contentBounds, childBounds);

  for (const { item, bounds: childBounds } of rectangles) {
    item.bounds = roundBounds(insetBounds(childBounds, gutter / 2));
  }

  return { growthArea: roundBounds(growthArea) };
}

export function placeChildrenInGrowth(children, bounds) {
  if (children.length === 0) return { growthArea: roundBounds(bounds) };
  const { childBounds, growthArea } = reserveGrowthArea(bounds, NEXT_GROWTH_FRACTION);
  const contentBounds = insetByRatio(childBounds, INNER_PADDING_RATIO, INNER_PADDING_MAX);
  const gutter = gutterFor(contentBounds, children.length);
  const ordered = orderedForLayout(children);
  const rectangles = layoutRectangles(ordered, contentBounds, childBounds);

  for (const { item, bounds: childBounds } of rectangles) {
    item.bounds = roundBounds(insetBounds(childBounds, gutter / 2));
  }

  return { growthArea: roundBounds(growthArea) };
}

export function nextGrowthArea(bounds) {
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

export function roundBounds(bounds) {
  return {
    x: round(bounds.x),
    y: round(bounds.y),
    width: round(Math.max(0, bounds.width)),
    height: round(Math.max(0, bounds.height)),
  };
}

function orderedForLayout(children) {
  return [...children].sort((a, b) => {
    const typeDelta = typeRank(a) - typeRank(b);
    if (typeDelta !== 0) return typeDelta;
    const weightDelta = layoutWeight(b) - layoutWeight(a);
    if (Math.abs(weightDelta) > 1e-9) return weightDelta;
    return a.path.localeCompare(b.path);
  });
}

function layoutWeight(child) {
  const size = Math.sqrt(Math.max(1, child.lineCount || child.weight || 1));
  const childCount = child.type === "folder" ? child.folders.size + child.files.size : 0;
  const structure = child.type === "folder" ? Math.log2(childCount + 2) : 0;
  return Math.max(MIN_LAYOUT_WEIGHT, size + structure);
}

function typeRank(child) {
  return child.type === "folder" ? 0 : 1;
}

function squarify(children, bounds) {
  const totalWeight = children.reduce((sum, child) => sum + layoutWeight(child), 0);
  if (totalWeight <= 0 || bounds.width <= 0 || bounds.height <= 0) return [];

  const totalArea = bounds.width * bounds.height;
  const items = children.map((child) => ({
    item: child,
    area: (layoutWeight(child) / totalWeight) * totalArea,
  }));
  const rectangles = [];
  let remaining = { ...bounds };
  let row = [];

  for (const item of items) {
    const nextRow = [...row, item];
    if (row.length === 0 || worstAspect(nextRow, shortSide(remaining)) <= worstAspect(row, shortSide(remaining))) {
      row = nextRow;
      continue;
    }

    remaining = layoutRow(row, remaining, rectangles);
    row = [item];
  }

  if (row.length > 0) layoutRow(row, remaining, rectangles);
  return rectangles;
}

function layoutRectangles(children, preferredBounds, fallbackBounds) {
  const bounds = hasUsableArea(preferredBounds) ? preferredBounds : fallbackBounds;
  if (!hasUsableArea(bounds)) {
    return children.map((item) => ({ item, bounds }));
  }

  const rectangles = squarify(children, bounds);
  return rectangles.length === children.length ? rectangles : stripLayout(children, bounds);
}

function stripLayout(children, bounds) {
  const totalWeight = children.reduce((sum, child) => sum + layoutWeight(child), 0);
  const horizontal = bounds.width >= bounds.height;
  let cursor = horizontal ? bounds.x : bounds.y;

  return children.map((item, index) => {
    const isLast = index === children.length - 1;
    const span = isLast
      ? (horizontal ? bounds.x + bounds.width : bounds.y + bounds.height) - cursor
      : ((horizontal ? bounds.width : bounds.height) * layoutWeight(item)) / totalWeight;
    const childBounds = horizontal
      ? { x: cursor, y: bounds.y, width: span, height: bounds.height }
      : { x: bounds.x, y: cursor, width: bounds.width, height: span };
    cursor += span;
    return { item, bounds: childBounds };
  });
}

function layoutRow(row, bounds, rectangles) {
  const rowArea = row.reduce((sum, item) => sum + item.area, 0);
  if (rowArea <= 0 || bounds.width <= 0 || bounds.height <= 0) return bounds;

  if (bounds.width >= bounds.height) {
    const rowHeight = Math.min(bounds.height, rowArea / bounds.width);
    let x = bounds.x;
    for (const entry of row) {
      const width = entry === row.at(-1)
        ? bounds.x + bounds.width - x
        : entry.area / Math.max(rowHeight, Number.EPSILON);
      rectangles.push({ item: entry.item, bounds: { x, y: bounds.y, width, height: rowHeight } });
      x += width;
    }
    return { x: bounds.x, y: bounds.y + rowHeight, width: bounds.width, height: Math.max(0, bounds.height - rowHeight) };
  }

  const columnWidth = Math.min(bounds.width, rowArea / bounds.height);
  let y = bounds.y;
  for (const entry of row) {
    const height = entry === row.at(-1)
      ? bounds.y + bounds.height - y
      : entry.area / Math.max(columnWidth, Number.EPSILON);
    rectangles.push({ item: entry.item, bounds: { x: bounds.x, y, width: columnWidth, height } });
    y += height;
  }
  return { x: bounds.x + columnWidth, y: bounds.y, width: Math.max(0, bounds.width - columnWidth), height: bounds.height };
}

function worstAspect(row, side) {
  if (row.length === 0 || side <= 0) return Infinity;
  const areas = row.map((item) => item.area).filter((area) => area > 0);
  if (areas.length === 0) return Infinity;
  const sum = areas.reduce((total, area) => total + area, 0);
  const minArea = Math.min(...areas);
  const maxArea = Math.max(...areas);
  const sideSquared = side * side;
  const sumSquared = sum * sum;
  return Math.max((sideSquared * maxArea) / sumSquared, sumSquared / (sideSquared * minArea));
}

function reserveGrowthArea(bounds, fraction) {
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

function shortSide(bounds) {
  return Math.min(bounds.width, bounds.height);
}

function hasUsableArea(bounds) {
  return bounds.width > MIN_USABLE_SIDE && bounds.height > MIN_USABLE_SIDE;
}

function round(value) {
  return Number(value.toFixed(12));
}
