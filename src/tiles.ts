import { precisionForLevel } from "./levels.ts";
import type { Bounds } from "./geometry.js";
import type { GeohashedCoordinate } from "./geohash.js";
import type { MapLevel } from "./levels.js";

export type TileTargetType = "folder" | "file";

export type TileMapTarget = {
  path: string;
  name?: string;
  bounds: Bounds;
  geo: GeohashedCoordinate;
  lineCount?: number;
  weight?: number;
};

export type TileSerializedTarget = TileMapTarget & {
  targetType: TileTargetType;
};

export type TileCodemap = {
  folders: Record<string, TileMapTarget>;
  files: Record<string, TileMapTarget>;
};

export type Tile = {
  prefix: string;
  level: MapLevel;
  targets: TileSerializedTarget[];
};

export class TileIndexBuilder {
  prefixForTarget(target: TileMapTarget, level: MapLevel): string {
    return tilePrefixForTarget(target, level);
  }

  build(codemap: TileCodemap, level: MapLevel = "file"): Tile[] {
    return buildTileIndex(codemap, level);
  }

  get(codemap: TileCodemap, { level = "file", prefix }: { level?: MapLevel; prefix: string }): Tile {
    return getTile(codemap, { level, prefix });
  }

  visiblePrefixes(codemap: TileCodemap, level: MapLevel = "file"): string[] {
    return visiblePrefixes(codemap, level);
  }

  addTarget(tiles: Map<string, TileSerializedTarget[]>, prefix: string, target: TileSerializedTarget): void {
    addTarget(tiles, prefix, target);
  }

  mapTargets(codemap: TileCodemap): Generator<TileSerializedTarget> {
    return mapTargets(codemap);
  }

  sortedTargets(targets: Record<string, TileMapTarget>): TileMapTarget[] {
    return sortedTargets(targets);
  }

  serializeTarget(target: TileMapTarget, targetType: TileTargetType): TileSerializedTarget {
    return serializeTarget(target, targetType);
  }
}

export function tilePrefixForTarget(target: TileMapTarget, level: MapLevel): string {
  return target.geo.geohash.slice(0, precisionForLevel(level));
}

export function buildTileIndex(codemap: TileCodemap, level: MapLevel = "file"): Tile[] {
  const tiles = new Map<string, TileSerializedTarget[]>();

  for (const target of mapTargets(codemap)) {
    addTarget(tiles, tilePrefixForTarget(target, level), target);
  }

  const tileEntries: [string, TileSerializedTarget[]][] = [];
  for (const entry of tiles.entries()) tileEntries.push(entry);
  if (!tileEntriesAreSorted(tileEntries)) tileEntries.sort(([a], [b]) => a.localeCompare(b));
  const index: Tile[] = [];
  for (const [prefix, targets] of tileEntries) {
    index.push({ prefix, level, targets });
  }
  return index;
}

export function getTile(codemap: TileCodemap, { level = "file", prefix }: { level?: MapLevel; prefix: string }): Tile {
  const targets: TileSerializedTarget[] = [];
  appendMatchingTargets(targets, codemap.folders, "folder", level, prefix);
  appendMatchingTargets(targets, codemap.files, "file", level, prefix);
  return {
    prefix,
    level,
    targets,
  };
}

export function visiblePrefixes(codemap: TileCodemap, level: MapLevel = "file"): string[] {
  const prefixes = new Set<string>();
  for (const target of rawMapTargets(codemap)) {
    prefixes.add(tilePrefixForTarget(target, level));
  }
  const sorted: string[] = [];
  for (const prefix of prefixes) sorted.push(prefix);
  return stringsAreSorted(sorted) ? sorted : sorted.sort((a, b) => a.localeCompare(b));
}

function addTarget(tiles: Map<string, TileSerializedTarget[]>, prefix: string, target: TileSerializedTarget): void {
  if (!tiles.has(prefix)) tiles.set(prefix, []);
  tiles.get(prefix)?.push(target);
}

function* mapTargets(codemap: TileCodemap): Generator<TileSerializedTarget> {
  for (const folder of sortedTargets(codemap.folders)) {
    yield serializeTarget(folder, "folder");
  }

  for (const file of sortedTargets(codemap.files)) {
    yield serializeTarget(file, "file");
  }
}

function* rawMapTargets(codemap: TileCodemap): Generator<TileMapTarget> {
  yield* objectValues(codemap.folders);
  yield* objectValues(codemap.files);
}

function sortedTargets(targets: Record<string, TileMapTarget>): TileMapTarget[] {
  const sorted: TileMapTarget[] = [];
  for (const target of objectValues(targets)) {
    sorted.push(target);
  }
  return targetsAreSorted(sorted) ? sorted : sorted.sort((left, right) => left.path.localeCompare(right.path));
}

function appendMatchingTargets(
  serialized: TileSerializedTarget[],
  targets: Record<string, TileMapTarget>,
  targetType: TileTargetType,
  level: MapLevel,
  prefix: string,
): void {
  const matches: TileMapTarget[] = [];
  for (const target of objectValues(targets)) {
    if (tilePrefixForTarget(target, level) === prefix) matches.push(target);
  }
  if (!targetsAreSorted(matches)) matches.sort((left, right) => left.path.localeCompare(right.path));
  for (const target of matches) {
    serialized.push(serializeTarget(target, targetType));
  }
}

function* objectValues<T>(values: Record<string, T>): Generator<T> {
  for (const key in values) {
    if (Object.hasOwn(values, key)) yield values[key];
  }
}

function tileEntriesAreSorted(entries: [string, TileSerializedTarget[]][]): boolean {
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const current = entries[index];
    if (previous && current && previous[0].localeCompare(current[0]) > 0) return false;
  }
  return true;
}

function targetsAreSorted(targets: TileMapTarget[]): boolean {
  for (let index = 1; index < targets.length; index += 1) {
    const previous = targets[index - 1];
    const current = targets[index];
    if (previous && current && previous.path.localeCompare(current.path) > 0) return false;
  }
  return true;
}

function stringsAreSorted(values: string[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous !== undefined && current !== undefined && previous.localeCompare(current) > 0) return false;
  }
  return true;
}

function serializeTarget(target: TileMapTarget, targetType: TileTargetType): TileSerializedTarget {
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
