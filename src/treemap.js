import { geohashForBoundsCenter } from "./geohash.js";
import { FULL_GEOHASH_PRECISION } from "./levels.js";
import { sortedChildren, sortedFiles, sortedFolders } from "./tree.js";

const GROWTH_FRACTION = 0.05;

export function layoutTree(root) {
  assignFolderLayout(root, unitBounds());
  return root;
}

function assignFolderLayout(folder, bounds) {
  folder.bounds = roundBounds(bounds);
  folder.geo = geohashForBoundsCenter(folder.bounds, FULL_GEOHASH_PRECISION);

  const children = sortedChildren(folder);
  if (children.length === 0) {
    folder.growthArea = roundBounds(bounds);
    return;
  }

  const { childBounds, growthArea } = splitGrowthArea(bounds);
  folder.growthArea = roundBounds(growthArea);
  splitChildren(children, childBounds);

  for (const child of sortedFolders(folder)) assignFolderLayout(child, child.bounds);
  for (const child of sortedFiles(folder)) {
    child.bounds = roundBounds(child.bounds);
    child.geo = geohashForBoundsCenter(child.bounds, FULL_GEOHASH_PRECISION);
  }
}

function splitChildren(children, bounds) {
  const totalWeight = children.reduce((sum, child) => sum + child.weight, 0);
  const horizontal = bounds.width >= bounds.height;
  let cursor = horizontal ? bounds.x : bounds.y;

  children.forEach((child, index) => {
    const isLast = index === children.length - 1;
    const span = isLast
      ? (horizontal ? bounds.x + bounds.width : bounds.y + bounds.height) - cursor
      : ((horizontal ? bounds.width : bounds.height) * child.weight) / totalWeight;

    child.bounds = horizontal
      ? { x: cursor, y: bounds.y, width: span, height: bounds.height }
      : { x: bounds.x, y: cursor, width: bounds.width, height: span };
    cursor += span;
  });
}

function splitGrowthArea(bounds) {
  const horizontal = bounds.width >= bounds.height;
  if (horizontal) {
    const growthWidth = bounds.width * GROWTH_FRACTION;
    return {
      childBounds: { x: bounds.x, y: bounds.y, width: bounds.width - growthWidth, height: bounds.height },
      growthArea: { x: bounds.x + bounds.width - growthWidth, y: bounds.y, width: growthWidth, height: bounds.height },
    };
  }

  const growthHeight = bounds.height * GROWTH_FRACTION;
  return {
    childBounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height - growthHeight },
    growthArea: { x: bounds.x, y: bounds.y + bounds.height - growthHeight, width: bounds.width, height: growthHeight },
  };
}

function unitBounds() {
  return { x: 0, y: 0, width: 1, height: 1 };
}

function roundBounds(bounds) {
  return {
    x: round(bounds.x),
    y: round(bounds.y),
    width: round(bounds.width),
    height: round(bounds.height),
  };
}

function round(value) {
  return Number(value.toFixed(12));
}
