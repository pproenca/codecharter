import { precisionForLevel } from "./levels.js";

export class TileIndexBuilder {
  prefixForTarget(target, level) {
    return tilePrefixForTarget(target, level);
  }

  build(codemap, level = "file") {
    return buildTileIndex(codemap, level);
  }

  get(codemap, { level = "file", prefix }) {
    return getTile(codemap, { level, prefix });
  }

  visiblePrefixes(codemap, level = "file") {
    return visiblePrefixes(codemap, level);
  }

  addTarget(tiles, prefix, target) {
    addTarget(tiles, prefix, target);
  }

  mapTargets(codemap) {
    return mapTargets(codemap);
  }

  sortedTargets(targets) {
    return sortedTargets(targets);
  }

  serializeTarget(target, targetType) {
    return serializeTarget(target, targetType);
  }
}

export function tilePrefixForTarget(target, level) {
  return target.geo.geohash.slice(0, precisionForLevel(level));
}

export function buildTileIndex(codemap, level = "file") {
  const tiles = new Map();

  for (const target of mapTargets(codemap)) {
    addTarget(tiles, tilePrefixForTarget(target, level), target);
  }

  return [...tiles.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([prefix, targets]) => ({ prefix, level, targets }));
}

export function getTile(codemap, { level = "file", prefix }) {
  return {
    prefix,
    level,
    targets: [...mapTargets(codemap)].filter((target) => tilePrefixForTarget(target, level) === prefix),
  };
}

export function visiblePrefixes(codemap, level = "file") {
  return buildTileIndex(codemap, level).map((tile) => tile.prefix);
}

function addTarget(tiles, prefix, target) {
  if (!tiles.has(prefix)) tiles.set(prefix, []);
  tiles.get(prefix).push(target);
}

function* mapTargets(codemap) {
  for (const folder of sortedTargets(codemap.folders)) {
    yield serializeTarget(folder, "folder");
  }

  for (const file of sortedTargets(codemap.files)) {
    yield serializeTarget(file, "file");
  }
}

function sortedTargets(targets) {
  return Object.values(targets).sort((left, right) => left.path.localeCompare(right.path));
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
