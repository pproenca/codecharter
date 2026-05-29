/**
 * Resolve a path (+ optional line/column/fragment request) to a geohash address,
 * deep link, breadcrumb, and bounds.
 *
 * The address is the system's primary key, so output is byte-stable (BR-001
 * via geohash/geometry). The legacy `AddressResolver` wrapper class was test-only
 * scaffolding and is dropped; `resolveAddress` is the entry point.
 */

import { objectRecord, sortedUniqueStrings } from "./collections.ts";
import { createCodemapDeepLink } from "./deep-links.ts";
import type { GeohashedCoordinate } from "./geo-types.ts";
import { geohashForBoundsCenter } from "./geohash.ts";
import type { Bounds } from "./geometry.ts";
import { precisionForLevel } from "./levels.ts";
import type { MapLevel } from "./levels.ts";
import { codeRangeGeometry } from "./line-coordinate.ts";
import type {
  CodeRangeFragmentGeometry,
  CodeRangeRequest,
  NormalizedRange,
} from "./line-coordinate.ts";

export type MapFolderTarget = {
  path: string;
  bounds: Bounds;
  geo: GeohashedCoordinate;
};

export type MapFileTarget = MapFolderTarget & {
  lineCount: number;
  maxLineLength?: number;
};

export type CodecharterCodemap = {
  folders: Record<string, MapFolderTarget>;
  files: Record<string, MapFileTarget>;
};

export type AddressRequest = CodeRangeRequest & {
  path: string;
};

export type AddressTargetType = "folder" | "file" | "lineRange" | "tokenRange";

export type ResolvedAddressFragment = {
  level: "lineRange" | "tokenRange";
  targetType: "lineRange" | "tokenRange";
  geohash: string;
  lineRange: NormalizedRange;
  tokenRange?: NormalizedRange;
  bounds: Bounds;
  geo?: undefined;
};

export type ResolvedAddress = {
  level: MapLevel;
  targetType: AddressTargetType;
  path: string;
  geohash: string;
  deepLink: string;
  breadcrumb: string;
  bounds: Bounds;
  geo: GeohashedCoordinate;
  lineRange?: NormalizedRange;
  tokenRange?: NormalizedRange;
  coveringSet?: string[];
  fragments?: ResolvedAddressFragment[];
};

type FragmentCoverage = {
  fragments: ResolvedAddressFragment[];
  coveringSet: string[];
};

/** Resolve a path (+ optional code range) to its address. @throws if the path is not on the map. */
export function resolveAddress(
  codemap: CodecharterCodemap,
  request: AddressRequest,
): ResolvedAddress {
  const path = normalizePathForMap(request.path);
  // HARDENING (CWE-1321): require own properties so an untrusted key like
  // "__proto__" or "constructor" resolves to "not found" rather than the object
  // prototype (which would later throw an opaque 500).
  const file = Object.hasOwn(codemap.files, path) ? codemap.files[path] : undefined;
  const folder = Object.hasOwn(codemap.folders, path) ? codemap.folders[path] : undefined;

  if (file) {
    return resolveFileAddress(file, request);
  }
  if (folder) {
    return resolveFolderAddress(folder);
  }
  throw new Error(`No map target found for path: ${request.path}`);
}

/**
 * Structural guard for a codemap (**BR-037**) — a non-array object with object
 * `files` and `folders`. Used to reject a corrupt/untrusted map before serving.
 */
export function isCodecharterCodemap(value: unknown): value is CodecharterCodemap {
  const record = objectRecord(value);
  if (!record) {
    return false;
  }
  return objectRecord(record.files) !== null && objectRecord(record.folders) !== null;
}

/** Normalize a path to its codemap key form (slashes, `./` prefix, trailing slash, `.` → ""). */
export function normalizePathForMap(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
  return normalized === "." ? "" : normalized;
}

function resolveFolderAddress(folder: MapFolderTarget): ResolvedAddress {
  const level = "folder";
  const geohash = folder.geo.geohash.slice(0, precisionForLevel(level));
  return {
    level,
    targetType: "folder",
    path: folder.path,
    geohash,
    deepLink: deepLink(level, geohash, { path: folder.path }),
    breadcrumb: breadcrumbForPath(folder.path || "."),
    bounds: folder.bounds,
    geo: folder.geo,
  };
}

function resolveFileAddress(file: MapFileTarget, request: CodeRangeRequest): ResolvedAddress {
  if (hasCodeRangeRequest(request)) {
    return resolveCodeRangeAddress(file, request);
  }

  const level = "file";
  const geohash = file.geo.geohash.slice(0, precisionForLevel(level));
  return {
    level,
    targetType: "file",
    path: file.path,
    geohash,
    deepLink: deepLink(level, geohash, { path: file.path }),
    breadcrumb: breadcrumbForPath(file.path),
    bounds: file.bounds,
    geo: file.geo,
  };
}

function resolveCodeRangeAddress(file: MapFileTarget, request: CodeRangeRequest): ResolvedAddress {
  const geometry = codeRangeGeometry(file, request);
  const level = geometry.tokenRange || geometry.hasTokenFragments ? "tokenRange" : "lineRange";
  const geo = geoForBounds(geometry.anchorBounds, level);
  const lines = `${geometry.lineRange.start}-${geometry.lineRange.end}`;
  const fragmentCoverage = geometry.fragments
    ? geohashedFragmentsWithCoverage(geometry.fragments)
    : null;

  return {
    level,
    targetType: level,
    path: file.path,
    geohash: geo.geohash,
    deepLink: deepLink(level, geo.geohash, {
      path: file.path,
      lines,
      columns: geometry.tokenRange
        ? `${geometry.tokenRange.start}-${geometry.tokenRange.end}`
        : undefined,
    }),
    breadcrumb: `${breadcrumbForPath(file.path)}:${lines}${geometry.tokenRange ? `@${geometry.tokenRange.start}-${geometry.tokenRange.end}` : ""}`,
    bounds: geometry.bounds,
    geo,
    lineRange: geometry.lineRange,
    ...(geometry.tokenRange ? { tokenRange: geometry.tokenRange } : {}),
    ...(fragmentCoverage ? { coveringSet: fragmentCoverage.coveringSet } : {}),
    ...(fragmentCoverage ? { fragments: fragmentCoverage.fragments } : {}),
  };
}

function geoForBounds(bounds: Bounds, level: MapLevel): GeohashedCoordinate {
  return geohashForBoundsCenter(bounds, precisionForLevel(level));
}

function hasCodeRangeRequest(request: CodeRangeRequest): boolean {
  return (
    request.lineStart !== undefined ||
    request.lineEnd !== undefined ||
    request.columnStart !== undefined ||
    request.columnEnd !== undefined
  );
}

function geohashedFragmentsWithCoverage(fragments: CodeRangeFragmentGeometry[]): FragmentCoverage {
  const coverage = new Set<string>();
  const mapped: ResolvedAddressFragment[] = [];
  for (const fragment of fragments) {
    const level = fragment.tokenRange ? "tokenRange" : "lineRange";
    const geohash = geoForBounds(fragment.bounds, level).geohash;
    coverage.add(geohash);
    mapped.push({
      level,
      targetType: level,
      geohash,
      lineRange: fragment.lineRange,
      ...(fragment.tokenRange ? { tokenRange: fragment.tokenRange } : {}),
      bounds: fragment.bounds,
    });
  }
  return {
    fragments: mapped,
    coveringSet: sortedUniqueStrings(coverage),
  };
}

function breadcrumbForPath(path: string): string {
  return path.split("/").filter(Boolean).join(" > ") || ".";
}

function deepLink(
  level: MapLevel,
  geohash: string,
  metadata: Record<string, string | undefined>,
): string {
  return createCodemapDeepLink(level, geohash, metadata);
}
