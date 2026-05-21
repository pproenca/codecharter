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

  if (file) return resolveFileAddress(codemap, file, request);
  return resolveFolderAddress(codemap, folder);
}

function resolveFolderAddress(codemap, folder) {
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

function resolveFileAddress(codemap, file, request) {
  if (
    request.lineStart !== undefined
    || request.lineEnd !== undefined
    || request.columnStart !== undefined
    || request.columnEnd !== undefined
  ) {
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

function resolveCodeRangeAddress(file, request) {
  const geometry = codeRangeGeometry(file, request);
  const level = geometry.tokenRange || geometry.hasTokenFragments ? "tokenRange" : "lineRange";
  const geo = geoForBounds(geometry.anchorBounds, level);
  const lines = `${geometry.lineRange.start}-${geometry.lineRange.end}`;
  const fragments = geometry.fragments ? geohashedFragments(geometry.fragments) : undefined;

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
    ...(fragments ? { coveringSet: sortedUnique(fragments.map((fragment) => fragment.geohash)) } : {}),
    ...(fragments ? { fragments } : {}),
  };
}

export function normalizePathForMap(path) {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
  return normalized === "." ? "" : normalized;
}

function geoForBounds(bounds, level) {
  return geohashForBoundsCenter(bounds, precisionForLevel(level));
}

function geohashedFragments(fragments) {
  return fragments.map((fragment) => {
    const level = fragment.tokenRange ? "tokenRange" : "lineRange";
    const geohash = geoForBounds(fragment.bounds, level).geohash;
    return {
      level,
      targetType: level,
      geohash,
      lineRange: fragment.lineRange,
      ...(fragment.tokenRange ? { tokenRange: fragment.tokenRange } : {}),
      bounds: fragment.bounds,
    };
  });
}

function sortedUnique(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function breadcrumbForPath(path) {
  return path.split("/").filter(Boolean).join(" > ") || ".";
}

function deepLink(level, geohash, metadata) {
  return createCodemapDeepLink(level, geohash, metadata);
}
