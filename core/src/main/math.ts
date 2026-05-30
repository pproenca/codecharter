/**
 * Numeric helpers for `@codecharter/core`.
 *
 * `clamp`'s order of `Math.min`/`Math.max` is load-bearing for the BR-001
 * determinism contract, so it must not be "simplified".
 */

/** Constrain `value` to the inclusive `[min, max]` interval. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Round to 12 decimal places — the determinism anchor for every stored
 * coordinate (**BR-004**). Uses `toFixed(12)` (IEEE half-to-even), so the
 * rounding mode is part of the contract and must not be swapped for `Math.round`.
 */
export function round(value: number): number {
  return Number(value.toFixed(12));
}
