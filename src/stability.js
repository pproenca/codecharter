import { geohashForBoundsCenter } from "./geohash.js";
import { FULL_GEOHASH_PRECISION } from "./levels.js";
import { sortedChildren, sortedFiles, sortedFolders } from "./tree.js";

const NEXT_GROWTH_FRACTION = 0.2;

export function stabilizeTreeLayout(root, previous) {
  if (!previous) return root;
  stabilizeFolder(root, previous, root.bounds);
  return root;
}

function stabilizeFolder(folder, previous, fallbackBounds) {
  const previousFolder = previous.folders?.[folder.path];
  if (previousFolder) {
    folder.bounds = previousFolder.bounds;
    folder.geo = previousFolder.geo;
    folder.growthArea = previousFolder.growthArea ?? previousFolder.bounds;
  } else {
    folder.bounds = folder.bounds ?? fallbackBounds;
    folder.geo = geohashForBoundsCenter(folder.bounds, FULL_GEOHASH_PRECISION);
    folder.growthArea = folder.growthArea ?? folder.bounds;
  }

  const newChildren = [];

  for (const child of sortedFolders(folder)) {
    if (previous.folders?.[child.path]) {
      stabilizeFolder(child, previous, child.bounds);
    } else {
      newChildren.push(child);
    }
  }

  for (const child of sortedFiles(folder)) {
    const previousFile = previous.files?.[child.path];
    if (previousFile) {
      child.bounds = previousFile.bounds;
      child.geo = previousFile.geo;
    } else {
      newChildren.push(child);
    }
  }

  if (newChildren.length > 0) {
    placeNewChildren(newChildren, folder.growthArea ?? folder.bounds);
    folder.growthArea = nextGrowthArea(folder.growthArea ?? folder.bounds);
  }

  for (const child of newChildren.filter((child) => child.type === "folder")) {
    layoutNewFolder(child, child.bounds);
  }
}

function layoutNewFolder(folder, bounds) {
  folder.bounds = roundBounds(bounds);
  folder.geo = geohashForBoundsCenter(folder.bounds, FULL_GEOHASH_PRECISION);

  const children = sortedChildren(folder);
  if (children.length === 0) {
    folder.growthArea = folder.bounds;
    return;
  }

  const { childBounds, growthArea } = reserveGrowthArea(folder.bounds);
  folder.growthArea = growthArea;
  splitChildren(children, childBounds);

  for (const child of sortedFolders(folder)) layoutNewFolder(child, child.bounds);
  for (const child of sortedFiles(folder)) {
    child.bounds = roundBounds(child.bounds);
    child.geo = geohashForBoundsCenter(child.bounds, FULL_GEOHASH_PRECISION);
  }
}

function placeNewChildren(children, growthArea) {
  const { childBounds } = reserveGrowthArea(growthArea);
  splitChildren(children, childBounds);

  for (const child of children) {
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

function nextGrowthArea(bounds) {
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

function reserveGrowthArea(bounds) {
  const next = nextGrowthArea(bounds);
  const horizontal = bounds.width >= bounds.height;
  if (horizontal) {
    return {
      childBounds: roundBounds({
        x: bounds.x,
        y: bounds.y,
        width: Math.max(0, next.x - bounds.x),
        height: bounds.height,
      }),
      growthArea: next,
    };
  }

  return {
    childBounds: roundBounds({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: Math.max(0, next.y - bounds.y),
    }),
    growthArea: next,
  };
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
