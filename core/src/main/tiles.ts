/**
 * Tile indexing — bucket map targets by geohash prefix per zoom level (**BR-013**).
 *
 * Idiomatic note: the legacy `TileIndexBuilder` wrapper class was test-only
 * scaffolding and is dropped; only the free functions ship.
 */

import { objectValues, sortIfNeeded, sortedUniqueStrings } from "./collections.ts";
import type { GeohashedCoordinate } from "./geo-types.ts";
import type { Bounds } from "./geometry.ts";
import { precisionForLevel } from "./levels.ts";
import type { MapLevel } from "./levels.ts";

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

/** The geohash prefix that buckets a target at the given level. */
export function tilePrefixForTarget(target: TileMapTarget, level: MapLevel): string {
  return target.geo.geohash.slice(0, precisionForLevel(level));
}

/** Build the full tile index for a codemap at a level (folders before files, path-sorted). */
export function buildTileIndex(codemap: TileCodemap, level: MapLevel = "file"): Tile[] {
  const tiles = new Map<string, TileSerializedTarget[]>();
  for (const target of mapTargets(codemap)) {
    addTarget(tiles, tilePrefixForTarget(target, level), target);
  }
  const tileEntries = [...tiles.entries()];
  sortIfNeeded(tileEntries, compareTileEntries);
  return tileEntries.map(([prefix, targets]) => ({ prefix, level, targets }));
}

/** Fetch the single tile for an exact prefix. */
export function getTile(
  codemap: TileCodemap,
  { level = "file", prefix }: { level?: MapLevel; prefix: string },
): Tile {
  const targets: TileSerializedTarget[] = [];
  appendMatchingTargets(targets, codemap.folders, "folder", level, prefix);
  appendMatchingTargets(targets, codemap.files, "file", level, prefix);
  return { prefix, level, targets };
}

/** The sorted, unique set of tile prefixes present at a level. */
export function visiblePrefixes(codemap: TileCodemap, level: MapLevel = "file"): string[] {
  return sortedUniqueStrings(
    [...objectValues(codemap.folders), ...objectValues(codemap.files)].map((target) =>
      tilePrefixForTarget(target, level),
    ),
  );
}

function addTarget(
  tiles: Map<string, TileSerializedTarget[]>,
  prefix: string,
  target: TileSerializedTarget,
): void {
  if (!tiles.has(prefix)) {
    tiles.set(prefix, []);
  }
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

function sortedTargets(targets: Record<string, TileMapTarget>): TileMapTarget[] {
  return sortIfNeeded([...objectValues(targets)], compareTargetPaths);
}

function appendMatchingTargets(
  serialized: TileSerializedTarget[],
  targets: Record<string, TileMapTarget>,
  targetType: TileTargetType,
  level: MapLevel,
  prefix: string,
): void {
  const matches = [...objectValues(targets)].filter(
    (target) => tilePrefixForTarget(target, level) === prefix,
  );
  sortIfNeeded(matches, compareTargetPaths);
  for (const target of matches) {
    serialized.push(serializeTarget(target, targetType));
  }
}

function compareTileEntries(
  [left]: [string, TileSerializedTarget[]],
  [right]: [string, TileSerializedTarget[]],
): number {
  return left.localeCompare(right);
}

function compareTargetPaths(left: TileMapTarget, right: TileMapTarget): number {
  return left.path.localeCompare(right.path);
}

function serializeTarget(target: TileMapTarget, targetType: TileTargetType): TileSerializedTarget {
  return {
    targetType,
    path: target.path,
    bounds: target.bounds,
    geo: target.geo,
    ...(target.name === undefined ? {} : { name: target.name }),
    ...(target.lineCount === undefined ? {} : { lineCount: target.lineCount }),
    ...(target.weight === undefined ? {} : { weight: target.weight }),
  };
}
