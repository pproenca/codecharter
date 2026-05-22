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

  const tileEntries = [];
  for (const entry of tiles.entries()) tileEntries.push(entry);
  if (!tileEntriesAreSorted(tileEntries)) tileEntries.sort(([a], [b]) => a.localeCompare(b));
  const index = [];
  for (const [prefix, targets] of tileEntries) {
    index.push({ prefix, level, targets });
  }
  return index;
}

export function getTile(codemap, { level = "file", prefix }) {
  return {
    prefix,
    level,
    targets: [
      ...matchingTargets(codemap.folders, "folder", level, prefix),
      ...matchingTargets(codemap.files, "file", level, prefix),
    ],
  };
}

export function visiblePrefixes(codemap, level = "file") {
  const prefixes = new Set();
  for (const target of rawMapTargets(codemap)) {
    prefixes.add(tilePrefixForTarget(target, level));
  }
  const sorted = [];
  for (const prefix of prefixes) sorted.push(prefix);
  return stringsAreSorted(sorted) ? sorted : sorted.sort((a, b) => a.localeCompare(b));
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

function* rawMapTargets(codemap) {
  yield* objectValues(codemap.folders);
  yield* objectValues(codemap.files);
}

function sortedTargets(targets) {
  const sorted = [];
  for (const target of objectValues(targets)) {
    sorted.push(target);
  }
  return targetsAreSorted(sorted) ? sorted : sorted.sort((left, right) => left.path.localeCompare(right.path));
}

function matchingTargets(targets, targetType, level, prefix) {
  const matches = [];
  for (const target of objectValues(targets)) {
    if (tilePrefixForTarget(target, level) === prefix) matches.push(target);
  }
  if (!targetsAreSorted(matches)) matches.sort((left, right) => left.path.localeCompare(right.path));
  const serialized = [];
  for (const target of matches) {
    serialized.push(serializeTarget(target, targetType));
  }
  return serialized;
}

function* objectValues(values) {
  for (const key in values) {
    if (Object.hasOwn(values, key)) yield values[key];
  }
}

function tileEntriesAreSorted(entries) {
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index - 1][0].localeCompare(entries[index][0]) > 0) return false;
  }
  return true;
}

function targetsAreSorted(targets) {
  for (let index = 1; index < targets.length; index += 1) {
    if (targets[index - 1].path.localeCompare(targets[index].path) > 0) return false;
  }
  return true;
}

function stringsAreSorted(values) {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1].localeCompare(values[index]) > 0) return false;
  }
  return true;
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
