export function createMapHashRoute(kind, locator, metadata = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined && value !== "") params.set(key, value);
  }
  const query = params.toString();
  return `#/map/${encodeURIComponent(kind)}/${encodeURIComponent(locator)}${query ? `?${query}` : ""}`;
}

export function createAnnotationHashRoute(id) {
  return `#/annotation/${encodeURIComponent(id)}`;
}

export function createSelectionHashRoute({ level = "file", bounds }) {
  const params = new URLSearchParams({
    level,
    bounds: [bounds.x, bounds.y, bounds.width, bounds.height].map(formatRouteNumber).join(","),
  });
  return `#/selection?${params.toString()}`;
}

export function parseHashRoute(hash) {
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

export function boundsFromRouteParams(params) {
  const values = (params.get("bounds") ?? "").split(",").map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) return null;
  return {
    x: values[0],
    y: values[1],
    width: values[2],
    height: values[3],
  };
}

function formatRouteNumber(value) {
  return Number(value).toFixed(12).replace(/\.?0+$/, "");
}
