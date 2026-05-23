import type { Bounds } from "./geometry.js";

export type DeepLinkMetadata = Record<string, string | number | boolean | null | undefined>;

export type ParsedCodemapDeepLink = {
  kind: string;
  locator: string;
  metadata: Record<string, string>;
};

export type SelectionHashRouteInput = {
  level?: string;
  bounds: Bounds;
};

export class CodemapDeepLinkCodec {
  create(kind: string, locator: string, metadata: DeepLinkMetadata = {}): string { return createCodemapDeepLink(kind, locator, metadata); }

  parse(value: string): ParsedCodemapDeepLink { return parseCodemapDeepLink(value); }

  createBrowserHashRoute(kind: string, locator: string, metadata: DeepLinkMetadata = {}): string { return createBrowserHashRoute(kind, locator, metadata); }

  createAnnotationHashRoute(id: string): string { return createAnnotationHashRoute(id); }

  createSelectionHashRoute({ level = "file", bounds }: SelectionHashRouteInput): string { return createSelectionHashRoute({ level, bounds }); }

  searchParams(metadata: DeepLinkMetadata): URLSearchParams { return searchParams(metadata); }
}

export function createCodemapDeepLink(kind: string, locator: string, metadata: DeepLinkMetadata = {}): string {
  if (!kind) throw new Error("Deep link kind is required");
  if (!locator) throw new Error("Deep link locator is required");
  const query = searchParams(metadata).toString();
  return `codecharter://${encodeURIComponent(kind)}/${encodeURIComponent(locator)}${query ? `?${query}` : ""}`;
}

export function parseCodemapDeepLink(value: string): ParsedCodemapDeepLink {
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

export function createBrowserHashRoute(kind: string, locator: string, metadata: DeepLinkMetadata = {}): string {
  const query = searchParams(metadata).toString();
  return `#/map/${encodeURIComponent(kind)}/${encodeURIComponent(locator)}${query ? `?${query}` : ""}`;
}

export function createAnnotationHashRoute(id: string): string {
  if (!id) throw new Error("Annotation id is required");
  return `#/annotation/${encodeURIComponent(id)}`;
}

export function createSelectionHashRoute({ level = "file", bounds }: SelectionHashRouteInput): string {
  if (!bounds) throw new Error("Selection bounds are required");
  const params = new URLSearchParams({
    level,
    bounds: formatRouteBounds(bounds),
  });
  return `#/selection?${params.toString()}`;
}

function searchParams(metadata: DeepLinkMetadata): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return params;
}

function metadataFromSearchParams(params: URLSearchParams): Record<string, string> {
  return Object.fromEntries(params);
}

function formatRouteNumber(value: number): string {
  return Number(value).toFixed(12).replace(/\.?0+$/, "");
}

function formatRouteBounds(bounds: Bounds): string {
  return `${formatRouteNumber(bounds.x)},${formatRouteNumber(bounds.y)},${formatRouteNumber(bounds.width)},${formatRouteNumber(bounds.height)}`;
}
