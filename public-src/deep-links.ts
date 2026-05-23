// Browser TypeScript source. Run `pnpm build:public` to regenerate public/deep-links.js.
type RouteMetadata = Record<string, string | number | boolean | null | undefined>;
type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};
type BoundsTuple = [number, number, number, number];

export class BrowserHashRouteCodec {
  createMapRoute(kind: string, locator: string, metadata: RouteMetadata = {}): string { return createMapHashRoute(kind, locator, metadata); }

  createAnnotationRoute(id: string): string { return createAnnotationHashRoute(id); }

  createSelectionRoute({ level = "file", bounds }: { level?: string; bounds: Bounds }): string { return createSelectionHashRoute({ level, bounds }); }

  parse(hash: string): ReturnType<typeof parseHashRoute> { return parseHashRoute(hash); }

  boundsFromParams(params: URLSearchParams): Bounds | null { return boundsFromRouteParams(params); }

  searchParams(metadata: RouteMetadata): URLSearchParams { return searchParams(metadata); }
}

export function createMapHashRoute(kind: string, locator: string, metadata: RouteMetadata = {}): string {
  const query = searchParams(metadata).toString();
  return `#/map/${encodeURIComponent(kind)}/${encodeURIComponent(locator)}${query ? `?${query}` : ""}`;
}

export function createAnnotationHashRoute(id: string): string {
  return `#/annotation/${encodeURIComponent(id)}`;
}

export function createSelectionHashRoute({ level = "file", bounds }: { level?: string; bounds: Bounds }): string {
  const params = new URLSearchParams({
    level,
    bounds: formatRouteBounds(bounds),
  });
  return `#/selection?${params.toString()}`;
}

export function parseHashRoute(hash: string):
  | { type: "annotation"; id: string; params: URLSearchParams }
  | { type: "selection"; params: URLSearchParams }
  | { type: "map"; kind: string; locator: string; params: URLSearchParams }
  | null {
  if (!hash || hash === "#") return null;
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

  if (parts[0] === "map" && parts[1] && parts[2]) {
    return { type: "map", kind: parts[1], locator: parts[2], params };
  }

  return null;
}

export function boundsFromRouteParams(params: URLSearchParams): Bounds | null {
  const values = parseBoundsParam(params.get("bounds") ?? "");
  if (!isBoundsTuple(values) || !isValidSelectionBounds(values)) return null;
  return {
    x: values[0],
    y: values[1],
    width: values[2],
    height: values[3],
  };
}

function searchParams(metadata: RouteMetadata): URLSearchParams {
  return new URLSearchParams(
    Object.entries(metadata).flatMap(([key, value]) => value !== undefined && value !== "" ? [[key, String(value)]] : []),
  );
}

function formatRouteNumber(value: number): string {
  return value.toFixed(12).replace(/\.?0+$/, "");
}

function formatRouteBounds(bounds: Bounds): string {
  return `${formatRouteNumber(bounds.x)},${formatRouteNumber(bounds.y)},${formatRouteNumber(bounds.width)},${formatRouteNumber(bounds.height)}`;
}

function routeParts(path: string): string[] {
  return path.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
}

function parseBoundsParam(value: string): number[] {
  return value.split(",").map(Number);
}

function isBoundsTuple(values: number[]): values is BoundsTuple {
  return values.length === 4 && values.every((value) => Number.isFinite(value));
}

function isValidSelectionBounds([x, y, width, height]: BoundsTuple): boolean {
  if (width <= 0 || height <= 0) return false;
  if (x < 0 || y < 0 || x > 1 || y > 1) return false;
  return x + width <= 1 && y + height <= 1;
}
