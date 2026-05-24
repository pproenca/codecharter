import { DISTRICT_PALETTE } from "./constants.ts";
/**
 * Low-level helpers shared across the render-model modules: clamping, stable
 * sorting, deterministic string hashing, path normalization, and bounds math.
 * Behaviour is identical to the inline helpers in legacy `render-model.ts`.
 */
import type { Bounds, MapTarget, PaletteColor, Point, Rgb } from "./types.ts";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Sort in place only when the array is not already ordered (legacy parity). */
export function sortIfNeeded<T>(values: T[], compare: (left: T, right: T) => number): T[] {
  if (valuesAreSorted(values, compare)) {
    return values;
  }
  values.splice(0, values.length, ...values.toSorted(compare));
  return values;
}

export function valuesAreSorted<T>(values: T[], compare: (left: T, right: T) => number): boolean {
  for (let index = 1; index < values.length; index += 1) {
    if (compare(values[index - 1]!, values[index]!) > 0) {
      return false;
    }
  }
  return true;
}

/** Deterministic FNV-style 32-bit hash used for palette + organic-edge jitter. */
export function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function hashUnit(value: string): number {
  return hashString(value) / 0xffffffff;
}

export function* objectValues<T>(values: Record<string, T>): Generator<T> {
  for (const key in values) {
    const value = values[key];
    if (Object.hasOwn(values, key) && value !== undefined) {
      yield value;
    }
  }
}

export function pointDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function boundsCenter(bounds: Bounds): Point {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

export function containsBoundsPoint(bounds: Bounds, point: Point): boolean {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

export function normalizeMapPath(path: string | null | undefined): string {
  const normalized = String(path ?? "")
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
  return normalized === "." ? "" : normalized;
}

export function pathFromDeepLink(deepLink: string | null | undefined): string {
  if (!deepLink) {
    return "";
  }
  try {
    return new URL(deepLink).searchParams.get("path") ?? "";
  } catch {
    return "";
  }
}

export function rgba(rgb: Rgb, alpha: number): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

export function firstPathSegment(path: string): string {
  const slash = path.indexOf("/");
  return slash === -1 ? path : path.slice(0, slash);
}

export function lastPathSegment(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

export function paletteForPath(path: string): PaletteColor {
  return (
    DISTRICT_PALETTE[hashString(firstPathSegment(path)) % DISTRICT_PALETTE.length] ?? {
      fill: [126, 176, 156],
      stroke: [41, 98, 73],
      label: "#24513d",
    }
  );
}

export function compareTargetAreaThenPath(a: MapTarget, b: MapTarget): number {
  const aBounds = a.bounds ?? { width: 0, height: 0 };
  const bBounds = b.bounds ?? { width: 0, height: 0 };
  const areaDelta = aBounds.width * aBounds.height - bBounds.width * bBounds.height;
  if (Math.abs(areaDelta) > 1e-12) {
    return areaDelta;
  }
  return a.path.localeCompare(b.path);
}
