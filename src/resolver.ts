import { geohashForBoundsCenter } from "./geohash.ts";
import { precisionForLevel } from "./levels.ts";
import { createCodemapDeepLink } from "./deep-links.ts";
import { codeRangeGeometry } from "./line-coordinate.ts";
import { sortedUniqueStrings } from "./util.ts";
import type { Bounds } from "./geometry.js";
import type { GeohashedCoordinate } from "./geohash.js";
import type { MapLevel } from "./levels.js";
import type { CodeRangeFragmentGeometry, CodeRangeRequest, NormalizedRange } from "./line-coordinate.js";

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

export function resolveAddress(codemap: CodecharterCodemap, request: AddressRequest): ResolvedAddress {
  const path = normalizePathForMap(request.path);
  const file = codemap.files[path];
  const folder = codemap.folders[path];

  if (file) return resolveFileAddress(file, request);
  if (folder) return resolveFolderAddress(folder);
  throw new Error(`No map target found for path: ${request.path}`);
}

export class AddressResolver {
  private readonly codemap: CodecharterCodemap;

  constructor(codemap: CodecharterCodemap) {
    this.codemap = codemap;
  }

  resolve(request: AddressRequest): ResolvedAddress { return resolveAddress(this.codemap, request); }

  resolveFolder(folder: MapFolderTarget): ResolvedAddress { return resolveFolderAddress(folder); }

  resolveFile(file: MapFileTarget, request: CodeRangeRequest): ResolvedAddress { return resolveFileAddress(file, request); }

  resolveCodeRange(file: MapFileTarget, request: CodeRangeRequest): ResolvedAddress { return resolveCodeRangeAddress(file, request); }
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
  if (hasCodeRangeRequest(request)) return resolveCodeRangeAddress(file, request);

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
  const fragmentCoverage = geometry.fragments ? geohashedFragmentsWithCoverage(geometry.fragments) : null;

  return {
    level,
    targetType: level,
    path: file.path,
    geohash: geo.geohash,
    deepLink: deepLink(level, geo.geohash, { path: file.path, lines, columns: geometry.tokenRange ? `${geometry.tokenRange.start}-${geometry.tokenRange.end}` : undefined }),
    breadcrumb: `${breadcrumbForPath(file.path)}:${lines}${geometry.tokenRange ? `@${geometry.tokenRange.start}-${geometry.tokenRange.end}` : ""}`,
    bounds: geometry.bounds,
    geo,
    lineRange: geometry.lineRange,
    ...(geometry.tokenRange ? { tokenRange: geometry.tokenRange } : {}),
    ...(fragmentCoverage ? { coveringSet: fragmentCoverage.coveringSet } : {}),
    ...(fragmentCoverage ? { fragments: fragmentCoverage.fragments } : {}),
  };
}

export function normalizePathForMap(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
  return normalized === "." ? "" : normalized;
}

function geoForBounds(bounds: Bounds, level: MapLevel): GeohashedCoordinate {
  return geohashForBoundsCenter(bounds, precisionForLevel(level));
}

function hasCodeRangeRequest(request: CodeRangeRequest): boolean {
  return request.lineStart !== undefined
    || request.lineEnd !== undefined
    || request.columnStart !== undefined
    || request.columnEnd !== undefined;
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

function deepLink(level: MapLevel, geohash: string, metadata: Record<string, string | undefined>): string {
  return createCodemapDeepLink(level, geohash, metadata);
}
