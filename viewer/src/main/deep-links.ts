/**
 * Browser hash-route codec for the viewer (`#/map`, `#/annotation`, `#/selection`).
 * Implements **BR-030** (selection bounds validity: finite, in `[0,1]`, x+w≤1).
 *
 * Two deliberate changes from legacy `public-src/deep-links.ts`:
 *  1. The test-only `BrowserHashRouteCodec` wrapper class is dropped (Q7).
 *  2. `formatRouteNumber` now coerces with `Number(value)` to match
 *     `@codecharter/core`'s server-side codec — closing the client/server NaN
 *     divergence (tech-debt #3). For valid numeric bounds the output is identical.
 *
 * The `createMapHashRoute`/`createAnnotationHashRoute`/`createSelectionHashRoute`
 * helpers mirror core's `createBrowserHashRoute`/`createAnnotationHashRoute`/
 * `createSelectionHashRoute`; once the viewer build can import across packages
 * they should re-export the core versions directly (tracked follow-up).
 */

import type { MapRoute, MapRouteKind } from "./render/types.ts";

type RouteMetadata = Record<string, string | number | boolean | null | undefined>;
type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};
type BoundsTuple = [number, number, number, number];

export type HashRoute = MapRoute;

/** Build a `#/map/kind/locator?meta` route. */
export function createMapHashRoute(
  kind: MapRouteKind,
  locator: string,
  metadata: RouteMetadata = {},
): string {
  const query = searchParams(metadata).toString();
  return `#/map/${encodeURIComponent(kind)}/${encodeURIComponent(locator)}${query ? `?${query}` : ""}`;
}

/** Build a `#/annotation/<id>` route. */
export function createAnnotationHashRoute(id: string): string {
  return `#/annotation/${encodeURIComponent(id)}`;
}

/** Build a `#/selection?level=&bounds=` route. */
export function createSelectionHashRoute({
  level = "file",
  bounds,
}: {
  level?: string;
  bounds: Bounds;
}): string {
  const params = new URLSearchParams({ level, bounds: formatRouteBounds(bounds) });
  return `#/selection?${params.toString()}`;
}

/** Parse a window hash into a typed route, or `null` if unrecognized. */
export function parseHashRoute(hash: string): HashRoute | null {
  if (!hash || hash === "#") {
    return null;
  }
  const value = hash.startsWith("#") ? hash.slice(1) : hash;
  const queryStart = value.indexOf("?");
  const path = queryStart === -1 ? value : value.slice(0, queryStart);
  const query = queryStart === -1 ? "" : value.slice(queryStart + 1);
  const parts = routeParts(path);
  const params = new URLSearchParams(query);

  if (parts[0] === "annotation" && parts[1]) {
    return { type: "annotation", id: parts[1], params };
  }
  if (parts[0] === "selection") {
    return { type: "selection", params };
  }
  if (parts[0] === "map" && isMapRouteKind(parts[1]) && parts[2]) {
    return { type: "map", kind: parts[1], locator: parts[2], params };
  }
  return null;
}

/** Decode a `bounds` query param into a valid unit-square rectangle, or `null` (BR-030). */
export function boundsFromRouteParams(params: URLSearchParams): Bounds | null {
  const values = parseBoundsParam(params.get("bounds") ?? "");
  if (!isBoundsTuple(values) || !isValidSelectionBounds(values)) {
    return null;
  }
  return { x: values[0], y: values[1], width: values[2], height: values[3] };
}

function searchParams(metadata: RouteMetadata): URLSearchParams {
  return new URLSearchParams(
    Object.entries(metadata).flatMap(([key, value]) =>
      value !== undefined && value !== "" ? [[key, String(value)]] : [],
    ),
  );
}

// Unified with @codecharter/core's formatRouteNumber (debt #3): coerce via Number.
function formatRouteNumber(value: number): string {
  return Number(value)
    .toFixed(12)
    .replace(/\.?0+$/, "");
}

function formatRouteBounds(bounds: Bounds): string {
  return `${formatRouteNumber(bounds.x)},${formatRouteNumber(bounds.y)},${formatRouteNumber(bounds.width)},${formatRouteNumber(bounds.height)}`;
}

function routeParts(path: string): string[] {
  return path
    .split("/")
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));
}

function isMapRouteKind(kind: string | undefined): kind is MapRouteKind {
  return kind === "folder" || kind === "file" || kind === "lineRange" || kind === "tokenRange";
}

function parseBoundsParam(value: string): number[] {
  return value.split(",").map(Number);
}

function isBoundsTuple(values: number[]): values is BoundsTuple {
  return values.length === 4 && values.every((value) => Number.isFinite(value));
}

function isValidSelectionBounds([x, y, width, height]: BoundsTuple): boolean {
  if (width <= 0 || height <= 0) {
    return false;
  }
  if (x < 0 || y < 0 || x > 1 || y > 1) {
    return false;
  }
  return x + width <= 1 && y + height <= 1;
}
