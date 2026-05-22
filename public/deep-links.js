export class BrowserHashRouteCodec {
  createMapRoute(kind, locator, metadata = {}) {
    return createMapHashRoute(kind, locator, metadata);
  }

  createAnnotationRoute(id) {
    return createAnnotationHashRoute(id);
  }

  createSelectionRoute({ level = "file", bounds }) {
    return createSelectionHashRoute({ level, bounds });
  }

  parse(hash) {
    return parseHashRoute(hash);
  }

  boundsFromParams(params) {
    return boundsFromRouteParams(params);
  }

  searchParams(metadata) {
    return searchParams(metadata);
  }
}

export function createMapHashRoute(kind, locator, metadata = {}) {
  const query = searchParams(metadata).toString();
  return `#/map/${encodeURIComponent(kind)}/${encodeURIComponent(locator)}${query ? `?${query}` : ""}`;
}

export function createAnnotationHashRoute(id) {
  return `#/annotation/${encodeURIComponent(id)}`;
}

export function createSelectionHashRoute({ level = "file", bounds }) {
  const params = new URLSearchParams({
    level,
    bounds: formatRouteBounds(bounds),
  });
  return `#/selection?${params.toString()}`;
}

export function parseHashRoute(hash) {
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

export function boundsFromRouteParams(params) {
  const values = parseBoundsParam(params.get("bounds") ?? "");
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) return null;
  if (!isValidSelectionBounds(values)) return null;
  return {
    x: values[0],
    y: values[1],
    width: values[2],
    height: values[3],
  };
}

function searchParams(metadata) {
  const params = new URLSearchParams();
  for (const key in metadata) {
    if (!Object.hasOwn(metadata, key)) continue;
    const value = metadata[key];
    if (value !== undefined && value !== "") params.set(key, value);
  }
  return params;
}

function formatRouteNumber(value) {
  return Number(value).toFixed(12).replace(/\.?0+$/, "");
}

function formatRouteBounds(bounds) {
  return `${formatRouteNumber(bounds.x)},${formatRouteNumber(bounds.y)},${formatRouteNumber(bounds.width)},${formatRouteNumber(bounds.height)}`;
}

function routeParts(path) {
  const parts = [];
  let start = 0;
  for (let index = 0; index <= path.length; index += 1) {
    if (index < path.length && path[index] !== "/") continue;
    if (index > start) parts.push(decodeURIComponent(path.slice(start, index)));
    start = index + 1;
  }
  return parts;
}

function parseBoundsParam(value) {
  const bounds = [];
  let start = 0;
  for (let index = 0; index <= value.length; index += 1) {
    if (index < value.length && value[index] !== ",") continue;
    bounds.push(Number(value.slice(start, index)));
    start = index + 1;
  }
  return bounds;
}

function isValidSelectionBounds([x, y, width, height]) {
  if (width <= 0 || height <= 0) return false;
  if (x < 0 || y < 0 || x > 1 || y > 1) return false;
  return x + width <= 1 && y + height <= 1;
}
