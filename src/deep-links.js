export class CodemapDeepLinkCodec {
  create(kind, locator, metadata = {}) {
    if (!kind) throw new Error("Deep link kind is required");
    if (!locator) throw new Error("Deep link locator is required");
    const params = this.searchParams(metadata);
    const query = params.toString();
    return `codecharter://${encodeURIComponent(kind)}/${encodeURIComponent(locator)}${query ? `?${query}` : ""}`;
  }

  parse(value) {
    const url = new URL(value);
    if (url.protocol !== "codecharter:" && url.protocol !== "codemap:") throw new Error(`Unsupported deep link protocol: ${url.protocol}`);
    const kind = decodeURIComponent(url.hostname);
    const locator = decodeURIComponent(url.pathname.replace(/^\//, ""));
    return {
      kind,
      locator,
      metadata: Object.fromEntries(url.searchParams.entries()),
    };
  }

  createBrowserHashRoute(kind, locator, metadata = {}) {
    const params = this.searchParams(metadata);
    const query = params.toString();
    return `#/map/${encodeURIComponent(kind)}/${encodeURIComponent(locator)}${query ? `?${query}` : ""}`;
  }

  createAnnotationHashRoute(id) {
    if (!id) throw new Error("Annotation id is required");
    return `#/annotation/${encodeURIComponent(id)}`;
  }

  createSelectionHashRoute({ level = "file", bounds }) {
    if (!bounds) throw new Error("Selection bounds are required");
    const params = new URLSearchParams({
      level,
      bounds: [bounds.x, bounds.y, bounds.width, bounds.height].map(formatRouteNumber).join(","),
    });
    return `#/selection?${params.toString()}`;
  }

  searchParams(metadata) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(metadata)) {
      if (value !== undefined && value !== "") params.set(key, value);
    }
    return params;
  }
}

const CODEMAP_DEEP_LINK_CODEC = new CodemapDeepLinkCodec();

export function createCodemapDeepLink(kind, locator, metadata = {}) {
  return CODEMAP_DEEP_LINK_CODEC.create(kind, locator, metadata);
}

export function parseCodemapDeepLink(value) {
  return CODEMAP_DEEP_LINK_CODEC.parse(value);
}

export function createBrowserHashRoute(kind, locator, metadata = {}) {
  return CODEMAP_DEEP_LINK_CODEC.createBrowserHashRoute(kind, locator, metadata);
}

export function createAnnotationHashRoute(id) {
  return CODEMAP_DEEP_LINK_CODEC.createAnnotationHashRoute(id);
}

export function createSelectionHashRoute({ level = "file", bounds }) {
  return CODEMAP_DEEP_LINK_CODEC.createSelectionHashRoute({ level, bounds });
}

function formatRouteNumber(value) {
  return Number(value).toFixed(12).replace(/\.?0+$/, "");
}
