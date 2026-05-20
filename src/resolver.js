import { codePointToGeo, encodeGeohash } from "./geohash.js";
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
  if (request.lineStart !== undefined || request.lineEnd !== undefined) {
    return resolveLineRangeAddress(file, request);
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

function resolveLineRangeAddress(file, request) {
  const lineStart = normalizeLine(request.lineStart ?? request.lineEnd, file.lineCount);
  const lineEnd = normalizeLine(request.lineEnd ?? request.lineStart, file.lineCount);
  const start = Math.min(lineStart, lineEnd);
  const end = Math.max(lineStart, lineEnd);
  const startRatio = (start - 1) / file.lineCount;
  const endRatio = end / file.lineCount;
  const bounds = {
    x: file.bounds.x,
    y: round(file.bounds.y + file.bounds.height * startRatio),
    width: file.bounds.width,
    height: round(file.bounds.height * Math.max(endRatio - startRatio, 1 / file.lineCount)),
  };
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  const geo = codePointToGeo(center);
  const level = "lineRange";
  const geohash = encodeGeohash(geo.lat, geo.lon, precisionForLevel(level));

  return {
    level,
    targetType: "lineRange",
    geohash,
    deepLink: deepLink(level, geohash, { path: file.path, lines: `${start}-${end}` }),
    breadcrumb: `${breadcrumbForPath(file.path)}:${start}-${end}`,
    bounds,
    geo: { ...geo, geohash },
    lineRange: { start, end },
  };
}

function normalizePathForMap(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function normalizeLine(value, lineCount) {
  const line = Number(value);
  if (!Number.isInteger(line)) throw new Error(`Line must be an integer: ${value}`);
  return Math.min(lineCount, Math.max(1, line));
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
