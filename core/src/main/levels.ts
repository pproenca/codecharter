/**
 * Semantic map levels → geohash precision (**BR-003**).
 *
 * The precision each zoom level resolves to. `lineRange` and `tokenRange` are
 * both 12 — column granularity is therefore NOT encoded in the address string
 * (a documented quirk pending SME confirmation; see BUSINESS_RULES BR-003 / the
 * brief's Open Question Q5). Preserved as-is.
 */

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

/** Full address precision (= `lineRange` = 12). */
export const FULL_GEOHASH_PRECISION = MAP_LEVELS.lineRange;

/** Resolve a level to its geohash precision. @throws on an unknown level. */
export function precisionForLevel(level: MapLevel): number {
  const precision = MAP_LEVELS[level];
  if (!precision) throw new Error(`Unknown map level: ${level}`);
  return precision;
}
