import { geohashForBoundsCenter } from "./geohash.js";
import { precisionForLevel } from "./levels.js";
import { createCodemapDeepLink } from "./deep-links.js";
import { codeRangeGeometry } from "./line-coordinate.js";

export function resolveAddress(codemap, request) {
  const path = normalizePathForMap(request.path);
  const file = codemap.files[path];
  const folder = codemap.folders[path];

  if (!file && !folder) {
    throw new Error(`No map target found for path: ${request.path}`);
  }

  if (file) return resolveFileAddress(file, request);
  return resolveFolderAddress(folder);
}

export class AddressResolver {
  constructor(codemap) {
    this.codemap = codemap;
  }

  resolve(request) {
    return resolveAddress(this.codemap, request);
  }

  resolveFolder(folder) {
    return resolveFolderAddress(folder);
  }

  resolveFile(file, request) {
    return resolveFileAddress(file, request);
  }

  resolveCodeRange(file, request) {
    return resolveCodeRangeAddress(file, request);
  }
}

function resolveFolderAddress(folder) {
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

function resolveFileAddress(file, request) {
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

function resolveCodeRangeAddress(file, request) {
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

export function normalizePathForMap(path) {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
  return normalized === "." ? "" : normalized;
}

function geoForBounds(bounds, level) {
  return geohashForBoundsCenter(bounds, precisionForLevel(level));
}

function hasCodeRangeRequest(request) {
  return request.lineStart !== undefined
    || request.lineEnd !== undefined
    || request.columnStart !== undefined
    || request.columnEnd !== undefined;
}

function geohashedFragments(fragments) {
  return geohashedFragmentsWithCoverage(fragments).fragments;
}

function geohashedFragmentsWithCoverage(fragments) {
  const coverage = new Set();
  const mapped = [];
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
    coveringSet: sortedUnique(coverage),
  };
}

function sortedUnique(values) {
  const source = values instanceof Set ? values : new Set(values);
  const unique = [];
  for (const value of source) unique.push(value);
  return unique.sort((a, b) => a.localeCompare(b));
}

function breadcrumbForPath(path) {
  const segments = [];
  let segmentStart = 0;
  for (let index = 0; index <= path.length; index += 1) {
    if (index < path.length && path[index] !== "/") continue;
    if (index > segmentStart) segments.push(path.slice(segmentStart, index));
    segmentStart = index + 1;
  }
  return segments.length ? segments.join(" > ") : ".";
}

function deepLink(level, geohash, metadata) {
  return createCodemapDeepLink(level, geohash, metadata);
}
