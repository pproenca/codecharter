/**
 * `codecharter://` deep-link codec and browser `#/...` hash-route construction
 * (**BR-029** deep-link scheme/structure validation).
 */

import type { Bounds } from "./geometry.ts";
import { MAP_LEVELS } from "./levels.ts";
import type { MapLevel } from "./levels.ts";

export type DeepLinkMetadata = Record<string, string | number | boolean | null | undefined>;
export type DeepLinkKind = MapLevel | "annotation";

export type ParsedMapDeepLink = {
  kind: DeepLinkKind;
  locator: string;
  metadata: Record<string, string>;
};

export type SelectionHashRouteInput = {
  level?: string;
  bounds: Bounds;
};

/** Build a `codecharter://kind/locator?meta` deep link. @throws on empty kind/locator. */
export function createMapDeepLink(
  kind: DeepLinkKind,
  locator: string,
  metadata: DeepLinkMetadata = {},
): string {
  if (!kind) {
    throw new Error("Deep link kind is required");
  }
  if (!locator) {
    throw new Error("Deep link locator is required");
  }
  const query = searchParams(metadata).toString();
  return `codecharter://${encodeURIComponent(kind)}/${encodeURIComponent(locator)}${query ? `?${query}` : ""}`;
}

/** Parse a `codecharter:`/`codemap:` deep link. @throws on an unsupported scheme. */
export function parseMapDeepLink(value: string): ParsedMapDeepLink {
  const url = new URL(value);
  if (url.protocol !== "codecharter:" && url.protocol !== "codemap:") {
    throw new Error(`Unsupported deep link protocol: ${url.protocol}`);
  }
  const kind = decodeURIComponent(url.hostname);
  if (!isDeepLinkKind(kind)) {
    throw new Error(`Unsupported deep link kind: ${kind}`);
  }
  return {
    kind,
    locator: decodeURIComponent(url.pathname.replace(/^\//, "")),
    metadata: Object.fromEntries(url.searchParams),
  };
}

/** Build a browser `#/map/kind/locator?meta` hash route. */
export function createBrowserHashRoute(
  kind: MapLevel,
  locator: string,
  metadata: DeepLinkMetadata = {},
): string {
  const query = searchParams(metadata).toString();
  return `#/map/${encodeURIComponent(kind)}/${encodeURIComponent(locator)}${query ? `?${query}` : ""}`;
}

/** Build a browser `#/annotation/<id>` hash route. @throws on empty id. */
export function createAnnotationHashRoute(id: string): string {
  if (!id) {
    throw new Error("Annotation id is required");
  }
  return `#/annotation/${encodeURIComponent(id)}`;
}

/** Build a browser `#/selection?level=&bounds=` hash route. @throws on missing bounds. */
export function createSelectionHashRoute({
  level = "file",
  bounds,
}: SelectionHashRouteInput): string {
  if (!bounds) {
    throw new Error("Selection bounds are required");
  }
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
  return Number(value)
    .toFixed(12)
    .replace(/\.?0+$/, "");
}

function formatRouteBounds(bounds: Bounds): string {
  return `${formatRouteNumber(bounds.x)},${formatRouteNumber(bounds.y)},${formatRouteNumber(bounds.width)},${formatRouteNumber(bounds.height)}`;
}

function isDeepLinkKind(kind: string): kind is DeepLinkKind {
  return kind === "annotation" || Object.hasOwn(MAP_LEVELS, kind);
}
