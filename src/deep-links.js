export class CodemapDeepLinkCodec {
  create(kind, locator, metadata = {}) {
    return createCodemapDeepLink(kind, locator, metadata);
  }

  parse(value) {
    return parseCodemapDeepLink(value);
  }

  createBrowserHashRoute(kind, locator, metadata = {}) {
    return createBrowserHashRoute(kind, locator, metadata);
  }

  createAnnotationHashRoute(id) {
    return createAnnotationHashRoute(id);
  }

  createSelectionHashRoute({ level = "file", bounds }) {
    return createSelectionHashRoute({ level, bounds });
  }

  searchParams(metadata) {
    return searchParams(metadata);
  }
}

export function createCodemapDeepLink(kind, locator, metadata = {}) {
  if (!kind) throw new Error("Deep link kind is required");
  if (!locator) throw new Error("Deep link locator is required");
  const query = searchParams(metadata).toString();
  return `codecharter://${encodeURIComponent(kind)}/${encodeURIComponent(locator)}${query ? `?${query}` : ""}`;
}

export function parseCodemapDeepLink(value) {
  const url = new URL(value);
  if (url.protocol !== "codecharter:" && url.protocol !== "codemap:") throw new Error(`Unsupported deep link protocol: ${url.protocol}`);
  const kind = decodeURIComponent(url.hostname);
  const locator = decodeURIComponent(url.pathname.replace(/^\//, ""));
  return {
    kind,
    locator,
    metadata: metadataFromSearchParams(url.searchParams),
  };
}

export function createBrowserHashRoute(kind, locator, metadata = {}) {
  const query = searchParams(metadata).toString();
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
    bounds: formatRouteBounds(bounds),
  });
  return `#/selection?${params.toString()}`;
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

function metadataFromSearchParams(params) {
  const metadata = {};
  for (const [key, value] of params) metadata[key] = value;
  return metadata;
}

function formatRouteNumber(value) {
  return Number(value).toFixed(12).replace(/\.?0+$/, "");
}

function formatRouteBounds(bounds) {
  return `${formatRouteNumber(bounds.x)},${formatRouteNumber(bounds.y)},${formatRouteNumber(bounds.width)},${formatRouteNumber(bounds.height)}`;
}
