import { precisionForLevel } from "./levels.js";

export class TileIndexBuilder {
  prefixForTarget(target, level) {
    return target.geo.geohash.slice(0, precisionForLevel(level));
  }

  build(codemap, level = "file") {
    const tiles = new Map();

    for (const target of this.mapTargets(codemap)) {
      this.addTarget(tiles, this.prefixForTarget(target, level), target);
    }

    return [...tiles.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([prefix, targets]) => ({ prefix, level, targets }));
  }

  get(codemap, { level = "file", prefix }) {
    const targets = [];

    for (const target of this.mapTargets(codemap)) {
      if (this.prefixForTarget(target, level) === prefix) targets.push(target);
    }

    return { prefix, level, targets };
  }

  visiblePrefixes(codemap, level = "file") {
    return this.build(codemap, level).map((tile) => tile.prefix);
  }

  addTarget(tiles, prefix, target) {
    if (!tiles.has(prefix)) tiles.set(prefix, []);
    tiles.get(prefix).push(target);
  }

  *mapTargets(codemap) {
    for (const folder of this.sortedTargets(codemap.folders)) {
      yield this.serializeTarget(folder, "folder");
    }

    for (const file of this.sortedTargets(codemap.files)) {
      yield this.serializeTarget(file, "file");
    }
  }

  sortedTargets(targets) {
    return Object.values(targets).sort((left, right) => left.path.localeCompare(right.path));
  }

  serializeTarget(target, targetType) {
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
}

const TILE_INDEX_BUILDER = new TileIndexBuilder();

export function tilePrefixForTarget(target, level) {
  return TILE_INDEX_BUILDER.prefixForTarget(target, level);
}

export function buildTileIndex(codemap, level = "file") {
  return TILE_INDEX_BUILDER.build(codemap, level);
}

export function getTile(codemap, { level = "file", prefix }) {
  return TILE_INDEX_BUILDER.get(codemap, { level, prefix });
}

export function visiblePrefixes(codemap, level = "file") {
  return TILE_INDEX_BUILDER.visiblePrefixes(codemap, level);
}
