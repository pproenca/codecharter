/**
 * Code-plane geometry primitives for `@codecharter/core`.
 *
 * Owns `Point`/`Bounds` (seeded earlier by the geohash slice in `geo-types.ts`,
 * now their true home) and the rectangle math used across layout and resolution.
 * `roundBounds` applies the BR-004 12-decimal rounding to every coordinate.
 *
 * Note: this `roundBounds` does NOT floor width/height at 0 — that variant lives
 * in the district-layout module (a documented legacy divergence, BR-004).
 */

import { clamp, round } from "./math.ts";

/** A point in the unit-square code plane. */
export type Point = {
  x: number;
  y: number;
};

/** An axis-aligned rectangle in the unit-square code plane. */
export type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Strict AABB overlap — touching edges do NOT count as intersecting. */
export function intersects(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y;
}

/** Normalize a rectangle so width/height are non-negative, then round (BR-004). */
export function normalizeRect(rect: Bounds): Bounds {
  const x1 = Math.min(rect.x, rect.x + rect.width);
  const x2 = Math.max(rect.x, rect.x + rect.width);
  const y1 = Math.min(rect.y, rect.y + rect.height);
  const y2 = Math.max(rect.y, rect.y + rect.height);
  return roundBounds({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
}

/** Clamp every corner into the unit square, flooring extent at 0, then round. */
export function clampBounds(bounds: Bounds): Bounds {
  const x1 = clamp(bounds.x, 0, 1);
  const y1 = clamp(bounds.y, 0, 1);
  const x2 = clamp(bounds.x + bounds.width, 0, 1);
  const y2 = clamp(bounds.y + bounds.height, 0, 1);
  return roundBounds({ x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) });
}

/** Round all four components to 12 decimals (BR-004). Does not floor extent. */
export function roundBounds(bounds: Bounds): Bounds {
  return {
    x: round(bounds.x),
    y: round(bounds.y),
    width: round(bounds.width),
    height: round(bounds.height),
  };
}
