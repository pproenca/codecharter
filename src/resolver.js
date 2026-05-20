import { geohashForBoundsCenter } from "./geohash.js";
import { precisionForLevel } from "./levels.js";

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
    geohash,
    deepLink: deepLink(level, geohash, { path: file.path }),
    breadcrumb: breadcrumbForPath(file.path),
    bounds: file.bounds,
    geo: file.geo,
  };
}

function resolveCodeRangeAddress(file, request) {
  const lineStart = normalizeLine(request.lineStart ?? request.lineEnd, file.lineCount);
  const lineEnd = normalizeLine(request.lineEnd ?? request.lineStart, file.lineCount);
  const start = Math.min(lineStart, lineEnd);
  const end = Math.max(lineStart, lineEnd);
  const lineBounds = lineRangeBounds(file, start, end);
  const tokenRange = resolveTokenRange(file, request);
  const fragments = resolveFragments(file, request.fragments);
  const bounds = fragments.length
    ? unionBounds(fragments.map((fragment) => fragment.bounds))
    : tokenRange ? tokenBounds(file, lineBounds, tokenRange) : lineBounds;
  const hasTokenFragments = fragments.some((fragment) => fragment.tokenRange);
  const level = tokenRange || hasTokenFragments ? "tokenRange" : "lineRange";
  const geo = geoForBounds(fragments[0]?.bounds ?? bounds, level);
  const lines = `${start}-${end}`;

  return {
    level,
    targetType: level,
    geohash: geo.geohash,
    deepLink: deepLink(level, geo.geohash, { path: file.path, lines, columns: tokenRange ? `${tokenRange.start}-${tokenRange.end}` : undefined }),
    breadcrumb: `${breadcrumbForPath(file.path)}:${lines}${tokenRange ? `@${tokenRange.start}-${tokenRange.end}` : ""}`,
    bounds,
    geo,
    lineRange: { start, end },
    ...(tokenRange ? { tokenRange } : {}),
    ...(fragments.length ? { coveringSet: sortedUnique(fragments.map((fragment) => fragment.geohash)) } : {}),
    ...(fragments.length ? { fragments } : {}),
  };
}

function lineRangeBounds(file, start, end) {
  const startRatio = (start - 1) / file.lineCount;
  const endRatio = end / file.lineCount;
  return {
    x: file.bounds.x,
    y: round(file.bounds.y + file.bounds.height * startRatio),
    width: file.bounds.width,
    height: round(file.bounds.height * Math.max(endRatio - startRatio, 1 / file.lineCount)),
  };
}

function resolveTokenRange(file, request) {
  if (request.columnStart === undefined && request.columnEnd === undefined) return null;
  const width = Math.max(1, file.maxLineLength ?? 1);
  const columnStart = normalizeColumn(request.columnStart ?? request.columnEnd, width);
  const columnEnd = normalizeColumn(request.columnEnd ?? request.columnStart, width);
  return {
    start: Math.min(columnStart, columnEnd),
    end: Math.max(columnStart, columnEnd),
  };
}

function tokenBounds(file, lineBounds, tokenRange) {
  const width = Math.max(1, file.maxLineLength ?? 1);
  const startRatio = (tokenRange.start - 1) / width;
  const endRatio = tokenRange.end / width;
  return {
    x: round(file.bounds.x + file.bounds.width * startRatio),
    y: lineBounds.y,
    width: round(file.bounds.width * Math.max(endRatio - startRatio, 1 / width)),
    height: lineBounds.height,
  };
}

function resolveFragments(file, fragments) {
  if (!Array.isArray(fragments)) return [];
  return fragments
    .map((fragment) => resolveFragment(file, fragment))
    .filter(Boolean);
}

function resolveFragment(file, fragment) {
  if (fragment?.lineStart === undefined && fragment?.lineEnd === undefined) return null;
  const lineStart = normalizeLine(fragment.lineStart ?? fragment.lineEnd, file.lineCount);
  const lineEnd = normalizeLine(fragment.lineEnd ?? fragment.lineStart, file.lineCount);
  const start = Math.min(lineStart, lineEnd);
  const end = Math.max(lineStart, lineEnd);
  const tokenRange = resolveTokenRange(file, fragment);
  const lineBounds = lineRangeBounds(file, start, end);
  const bounds = tokenRange ? tokenBounds(file, lineBounds, tokenRange) : lineBounds;
  const level = tokenRange ? "tokenRange" : "lineRange";
  const geo = geoForBounds(bounds, level);
  return {
    level,
    targetType: level,
    geohash: geo.geohash,
    lineRange: { start, end },
    ...(tokenRange ? { tokenRange } : {}),
    bounds,
    geo,
  };
}

function unionBounds(boundsList) {
  const x1 = Math.min(...boundsList.map((bounds) => bounds.x));
  const y1 = Math.min(...boundsList.map((bounds) => bounds.y));
  const x2 = Math.max(...boundsList.map((bounds) => bounds.x + bounds.width));
  const y2 = Math.max(...boundsList.map((bounds) => bounds.y + bounds.height));
  return {
    x: round(x1),
    y: round(y1),
    width: round(x2 - x1),
    height: round(y2 - y1),
  };
}

function normalizePathForMap(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function geoForBounds(bounds, level) {
  return geohashForBoundsCenter(bounds, precisionForLevel(level));
}

function sortedUnique(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function normalizeLine(value, lineCount) {
  const line = Number(value);
  if (!Number.isInteger(line)) throw new Error(`Line must be an integer: ${value}`);
  return Math.min(lineCount, Math.max(1, line));
}

function normalizeColumn(value, maxLineLength) {
  const column = Number(value);
  if (!Number.isInteger(column)) throw new Error(`Column must be an integer: ${value}`);
  return Math.min(maxLineLength, Math.max(1, column));
}

function breadcrumbForPath(path) {
  return path.split("/").filter(Boolean).join(" > ") || ".";
}

function deepLink(level, geohash, metadata) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined && value !== "") params.set(key, value);
  }
  const query = params.toString();
  return `codemap://${level}/${geohash}${query ? `?${query}` : ""}`;
}

function round(value) {
  return Number(value.toFixed(12));
}
