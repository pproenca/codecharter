import { precisionForLevel } from "./levels.js";

export function tilePrefixForTarget(target, level) {
  return target.geo.geohash.slice(0, precisionForLevel(level));
}

export function buildTileIndex(codemap, level = "file") {
  const tiles = new Map();

  for (const folder of Object.values(codemap.folders)) {
    addTarget(tiles, tilePrefixForTarget(folder, level), serializeTarget(folder, "folder"));
  }

  for (const file of Object.values(codemap.files)) {
    addTarget(tiles, tilePrefixForTarget(file, level), serializeTarget(file, "file"));
  }

  return [...tiles.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([prefix, targets]) => ({ prefix, level, targets }));
}

export function getTile(codemap, { level = "file", prefix }) {
  const targets = [];

  for (const folder of Object.values(codemap.folders)) {
    if (tilePrefixForTarget(folder, level) === prefix) targets.push(serializeTarget(folder, "folder"));
  }

  for (const file of Object.values(codemap.files)) {
    if (tilePrefixForTarget(file, level) === prefix) targets.push(serializeTarget(file, "file"));
  }

  return { prefix, level, targets };
}

export function visiblePrefixes(codemap, level = "file") {
  return buildTileIndex(codemap, level).map((tile) => tile.prefix);
}

function addTarget(tiles, prefix, target) {
  if (!tiles.has(prefix)) tiles.set(prefix, []);
  tiles.get(prefix).push(target);
}

function serializeTarget(target, targetType) {
  return {
    targetType,
    path: target.path,
    name: target.name,
    bounds: target.bounds,
    geo: target.geo,
    lineCount: target.lineCount,
    weight: target.weight,
  };
}
