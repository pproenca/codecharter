/**
 * `codecharter://` deep-link codec and browser `#/...` hash-route construction
 * (**BR-029** deep-link scheme/structure validation).
 *
 * Idiomatic note: the legacy `CodemapDeepLinkCodec` wrapper class was test-only
 * scaffolding (no production caller — see ASSESSMENT dangling refs) and is
 * dropped; only the free functions ship. The browser twin in
 * `public-src/deep-links.ts` must import this canonical version once the viewer
 * is transformed (resolves the client/server `formatRouteNumber` NaN divergence,
 * tech-debt #3).
 */

import type { Bounds } from "./geometry.ts";

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

/** Build a `codecharter://kind/locator?meta` deep link. @throws on empty kind/locator. */
export function createCodemapDeepLink(kind: string, locator: string, metadata: DeepLinkMetadata = {}): string {
  if (!kind) throw new Error("Deep link kind is required");
  if (!locator) throw new Error("Deep link locator is required");
  const query = searchParams(metadata).toString();
  return `codecharter://${encodeURIComponent(kind)}/${encodeURIComponent(locator)}${query ? `?${query}` : ""}`;
}

/** Parse a `codecharter:`/`codemap:` deep link. @throws on an unsupported scheme. */
export function parseCodemapDeepLink(value: string): ParsedCodemapDeepLink {
  const url = new URL(value);
  if (url.protocol !== "codecharter:" && url.protocol !== "codemap:") {
    throw new Error(`Unsupported deep link protocol: ${url.protocol}`);
  }
  return {
    kind: decodeURIComponent(url.hostname),
    locator: decodeURIComponent(url.pathname.replace(/^\//, "")),
    metadata: Object.fromEntries(url.searchParams),
  };
}

/** Build a browser `#/map/kind/locator?meta` hash route. */
export function createBrowserHashRoute(kind: string, locator: string, metadata: DeepLinkMetadata = {}): string {
  const query = searchParams(metadata).toString();
  return `#/map/${encodeURIComponent(kind)}/${encodeURIComponent(locator)}${query ? `?${query}` : ""}`;
}

/** Build a browser `#/annotation/<id>` hash route. @throws on empty id. */
export function createAnnotationHashRoute(id: string): string {
  if (!id) throw new Error("Annotation id is required");
  return `#/annotation/${encodeURIComponent(id)}`;
}

/** Build a browser `#/selection?level=&bounds=` hash route. @throws on missing bounds. */
export function createSelectionHashRoute({ level = "file", bounds }: SelectionHashRouteInput): string {
  if (!bounds) throw new Error("Selection bounds are required");
  const params = new URLSearchParams({ level, bounds: formatRouteBounds(bounds) });
  return `#/selection?${params.toString()}`;
}

/** Metadata → query string, dropping `undefined` and empty-string values (insertion order preserved). */
function searchParams(metadata: DeepLinkMetadata): URLSearchParams {
  return new URLSearchParams(
    Object.entries(metadata).flatMap(([key, value]) =>
      value !== undefined && value !== "" ? [[key, String(value)]] : [],
    ),
  );
}

function formatRouteNumber(value: number): string {
  return Number(value).toFixed(12).replace(/\.?0+$/, "");
}

function formatRouteBounds(bounds: Bounds): string {
  return `${formatRouteNumber(bounds.x)},${formatRouteNumber(bounds.y)},${formatRouteNumber(bounds.width)},${formatRouteNumber(bounds.height)}`;
}
