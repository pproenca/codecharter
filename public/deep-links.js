export class BrowserHashRouteCodec {
  createMapRoute(kind, locator, metadata = {}) {
    const params = this.searchParams(metadata);
    const query = params.toString();
    return `#/map/${encodeURIComponent(kind)}/${encodeURIComponent(locator)}${query ? `?${query}` : ""}`;
  }

  createAnnotationRoute(id) {
    return `#/annotation/${encodeURIComponent(id)}`;
  }

  createSelectionRoute({ level = "file", bounds }) {
    const params = new URLSearchParams({
      level,
      bounds: [bounds.x, bounds.y, bounds.width, bounds.height].map(formatRouteNumber).join(","),
    });
    return `#/selection?${params.toString()}`;
  }

  parse(hash) {
    if (!hash || hash === "#") return null;
    const value = hash.startsWith("#") ? hash.slice(1) : hash;
    const [path, query = ""] = value.split("?");
    const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
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

  boundsFromParams(params) {
    const values = (params.get("bounds") ?? "").split(",").map(Number);
    if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) return null;
    if (!isValidSelectionBounds(values)) return null;
    return {
      x: values[0],
      y: values[1],
      width: values[2],
      height: values[3],
    };
  }

  searchParams(metadata) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(metadata)) {
      if (value !== undefined && value !== "") params.set(key, value);
    }
    return params;
  }
}

const BROWSER_HASH_ROUTE_CODEC = new BrowserHashRouteCodec();

export function createMapHashRoute(kind, locator, metadata = {}) {
  return BROWSER_HASH_ROUTE_CODEC.createMapRoute(kind, locator, metadata);
}

export function createAnnotationHashRoute(id) {
  return BROWSER_HASH_ROUTE_CODEC.createAnnotationRoute(id);
}

export function createSelectionHashRoute({ level = "file", bounds }) {
  return BROWSER_HASH_ROUTE_CODEC.createSelectionRoute({ level, bounds });
}

export function parseHashRoute(hash) {
  return BROWSER_HASH_ROUTE_CODEC.parse(hash);
}

export function boundsFromRouteParams(params) {
  return BROWSER_HASH_ROUTE_CODEC.boundsFromParams(params);
}

function formatRouteNumber(value) {
  return Number(value).toFixed(12).replace(/\.?0+$/, "");
}

function isValidSelectionBounds([x, y, width, height]) {
  if (width <= 0 || height <= 0) return false;
  if (x < 0 || y < 0 || x > 1 || y > 1) return false;
  return x + width <= 1 && y + height <= 1;
}
