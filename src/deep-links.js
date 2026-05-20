export function createCodemapDeepLink(kind, locator, metadata = {}) {
  if (!kind) throw new Error("Deep link kind is required");
  if (!locator) throw new Error("Deep link locator is required");
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined && value !== "") params.set(key, value);
  }
  const query = params.toString();
  return `codemap://${encodeURIComponent(kind)}/${encodeURIComponent(locator)}${query ? `?${query}` : ""}`;
}

export function parseCodemapDeepLink(value) {
  const url = new URL(value);
  if (url.protocol !== "codemap:") throw new Error(`Unsupported deep link protocol: ${url.protocol}`);
  const kind = decodeURIComponent(url.hostname);
  const locator = decodeURIComponent(url.pathname.replace(/^\//, ""));
  return {
    kind,
    locator,
    metadata: Object.fromEntries(url.searchParams.entries()),
  };
}

export function createBrowserHashRoute(kind, locator, metadata = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined && value !== "") params.set(key, value);
  }
  const query = params.toString();
  return `#/map/${encodeURIComponent(kind)}/${encodeURIComponent(locator)}${query ? `?${query}` : ""}`;
}

export function createAnnotationHashRoute(id) {
  if (!id) throw new Error("Annotation id is required");
  return `#/annotation/${encodeURIComponent(id)}`;
}

export function createSelectionHashRoute({ level = "file", bounds }) {
  if (!bounds) throw new Error("Selection bounds are required");
  const params = new URLSearchParams({
    level,
    bounds: [bounds.x, bounds.y, bounds.width, bounds.height].map(formatRouteNumber).join(","),
  });
  return `#/selection?${params.toString()}`;
}

function formatRouteNumber(value) {
  return Number(value).toFixed(12).replace(/\.?0+$/, "");
}
