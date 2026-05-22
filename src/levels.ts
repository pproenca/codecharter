export const MAP_LEVELS = Object.freeze({
  world: 1,
  region: 2,
  folder: 4,
  file: 7,
  code: 10,
  lineRange: 12,
  tokenRange: 12,
});

export type MapLevel = keyof typeof MAP_LEVELS;

export const FULL_GEOHASH_PRECISION = MAP_LEVELS.lineRange;

export function precisionForLevel(level: MapLevel): number {
  const precision = MAP_LEVELS[level];
  if (!precision) throw new Error(`Unknown map level: ${level}`);
  return precision;
}
