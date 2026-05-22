import { randomUUID } from "node:crypto";
import { createAnnotationHashRoute, createCodemapDeepLink } from "./deep-links.js";
import { codePointToGeo, encodeGeohash } from "./geohash.js";
import { clampBounds, intersects, normalizeRect } from "./geometry.js";
import { precisionForLevel } from "./levels.js";
import { codeRangeRequestForSelection } from "./line-coordinate.js";
import { resolveAddress } from "./resolver.js";

const DEFAULT_ANNOTATION_NAME = "Map annotation";
const ANNOTATION_NAME_MAX_LENGTH = 72;

const SELECTION_RESOLVERS = new Map([
  ["world", (codemap, geometry, level) => resolveFolderTargets(codemap, geometry, level, { includeRoot: true, rootOnly: true })],
  ["region", resolveFolderTargets],
  ["folder", resolveFolderTargets],
  ["file", resolveFileTargets],
  ["code", (codemap, geometry, level) => resolveCodeTargets(codemap, geometry, level, "lineRange")],
  ["lineRange", (codemap, geometry, level) => resolveCodeTargets(codemap, geometry, level, "lineRange")],
  ["tokenRange", (codemap, geometry, level) => resolveCodeTargets(codemap, geometry, level, "tokenRange")],
]);

export function resolveSelection(codemap, selection) {
  const level = selection.level ?? "file";
  const geometry = normalizeSelectionGeometry(selection.geometry);
  const targets = selectionResolverForLevel(level)(codemap, geometry, level);

  const coveringSet = sortedUniqueGeohashes(targets);

  return {
    geometry,
    spatialFrame: spatialFrameForGeometry(geometry, level),
    coveringSet,
    resolvedTargets: targets.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export function createNamedSelection(codemap, input) {
  const resolved = resolveSelection(codemap, input);
  const now = new Date().toISOString();
  return {
    id: input.id ?? randomUUID(),
    name: input.name ?? "Untitled Area",
    kind: "drawnSelection",
    level: input.level ?? "file",
    createdAt: now,
    updatedAt: now,
    ...resolved,
  };
}

export function createMapAnnotation(codemap, input) {
  const resolved = resolveSelection(codemap, input);
  const now = new Date().toISOString();
  return withAnnotationPrompt({
    id: input.id ?? randomUUID(),
    name: annotationName(input),
    kind: "mapAnnotation",
    comment: input.comment ?? "",
    level: input.level ?? "file",
    createdAt: now,
    updatedAt: now,
    ...resolved,
  });
}

export function createNamedAddress(input) {
  const now = new Date().toISOString();
  return {
    id: input.id ?? randomUUID(),
    name: input.name ?? "Untitled Place",
    kind: "mapAddress",
    createdAt: now,
    updatedAt: now,
    address: input.address,
  };
}

export function refreshPlaceResolution(codemap, place) {
  if (place?.kind !== "drawnSelection" && place?.kind !== "mapAnnotation") return place;
  const refreshed = {
    ...place,
    ...resolveSelection(codemap, {
      level: place.level,
      geometry: place.geometry,
    }),
  };
  return refreshed.kind === "mapAnnotation" ? withAnnotationPrompt(refreshed) : refreshed;
}

function normalizeSelectionGeometry(geometry) {
  if (!geometry || geometry.type !== "rect") {
    throw new Error("Only rectangle drawn selections are supported in v1");
  }
  const bounds = clampBounds(normalizeRect(geometry.bounds));
  if (bounds.width <= 0 || bounds.height <= 0) {
    throw new Error("Selection bounds must cover a non-zero area");
  }

  return {
    type: "rect",
    bounds,
  };
}

function resolvedTarget(target, targetType, level) {
  const precision = precisionForLevel(level);
  return {
    targetType,
    path: target.path,
    geohash: target.geo.geohash.slice(0, precision),
    bounds: target.bounds,
  };
}

function resolvedCodeTarget(codemap, file, selectionBounds, level, targetMode) {
  const address = resolveAddress(codemap, {
    path: file.path,
    ...codeRangeRequestForSelection(file, selectionBounds, targetMode),
  });
  const precision = precisionForLevel(level);
  return {
    targetType: address.targetType,
    path: file.path,
    geohash: address.geohash.slice(0, precision),
    bounds: address.bounds,
    lineRange: address.lineRange,
    ...(address.tokenRange ? { tokenRange: address.tokenRange } : {}),
    address,
  };
}

function selectionResolverForLevel(level) {
  const resolver = SELECTION_RESOLVERS.get(level);
  if (!resolver) throw new Error(`Unknown map level: ${level}`);
  return resolver;
}

function resolveFolderTargets(codemap, geometry, level, { includeRoot = false, rootOnly = false } = {}) {
  return intersectingTargets(codemap.folders, geometry.bounds, (folder) => {
    if (!includeRoot && folder.path === "") return null;
    if (rootOnly && folder.path !== "") return null;
    return resolvedTarget(folder, "folder", level);
  });
}

function resolveFileTargets(codemap, geometry, level) {
  return intersectingTargets(codemap.files, geometry.bounds, (file) => resolvedTarget(file, "file", level));
}

function resolveCodeTargets(codemap, geometry, level, targetMode) {
  return intersectingTargets(codemap.files, geometry.bounds, (file) => resolvedCodeTarget(codemap, file, geometry.bounds, level, targetMode));
}

function intersectingTargets(targets, bounds, resolve) {
  const resolved = [];
  for (const target of Object.values(targets)) {
    if (!intersects(bounds, target.bounds)) continue;
    const item = resolve(target);
    if (item) resolved.push(item);
  }
  return resolved;
}

function sortedUniqueGeohashes(targets) {
  const geohashes = new Set();
  for (const target of targets) geohashes.add(target.geohash);
  return [...geohashes].sort((a, b) => a.localeCompare(b));
}

function spatialFrameForGeometry(geometry, level) {
  const { x, y, width, height } = geometry.bounds;
  const precision = precisionForLevel(level);
  const points = {
    northWest: { x, y },
    northEast: { x: x + width, y },
    southWest: { x, y: y + height },
    southEast: { x: x + width, y: y + height },
  };

  return {
    level,
    precision,
    bounds: geometry.bounds,
    corners: Object.fromEntries(
      Object.entries(points).map(([corner, point]) => {
        const geo = codePointToGeo(point);
        return [corner, encodeGeohash(geo.lat, geo.lon, precision)];
      }),
    ),
  };
}

function withAnnotationPrompt(annotation) {
  const linked = {
    ...annotation,
    deepLink: createCodemapDeepLink("annotation", annotation.id),
    browserHash: createAnnotationHashRoute(annotation.id),
  };
  return {
    ...linked,
    codexPrompt: codexPromptForAnnotation(linked),
  };
}

function codexPromptForAnnotation(annotation) {
  const comment = annotation.comment?.trim() || "<empty>";
  const reference = doubleQuote(annotation.deepLink);
  return [
    `CodeCharter annotation: ${annotation.deepLink}`,
    `Targets: ${annotation.resolvedTargets.length}`,
    `Note: ${comment}`,
    `CLI: codecharter --json resolve ${reference}`,
    `Fallback: npx --yes codecharter --json resolve ${reference}`,
    "Use resolve output; read only needed resolvedTargets. Do not use browser automation unless asked.",
  ].filter(Boolean).join("\n");
}

function doubleQuote(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function formatBounds(bounds) {
  return `x=${formatNumber(bounds.x)}, y=${formatNumber(bounds.y)}, width=${formatNumber(bounds.width)}, height=${formatNumber(bounds.height)}`;
}

function formatNumber(value) {
  return Number.parseFloat(value.toFixed(6)).toString();
}

function annotationName(input) {
  const explicit = input.name?.trim();
  if (explicit) return explicit;
  const comment = input.comment?.trim();
  if (!comment) return DEFAULT_ANNOTATION_NAME;
  const firstLine = firstNonblankLine(comment);
  if (!firstLine) return DEFAULT_ANNOTATION_NAME;
  return firstLine.length > ANNOTATION_NAME_MAX_LENGTH
    ? `${firstLine.slice(0, ANNOTATION_NAME_MAX_LENGTH - 3)}...`
    : firstLine;
}

function firstNonblankLine(value) {
  let start = 0;
  for (let index = 0; index <= value.length; index += 1) {
    if (index < value.length && value[index] !== "\n") continue;
    const line = value.slice(start, value[index - 1] === "\r" ? index - 1 : index).trim();
    if (line) return line;
    start = index + 1;
  }
  return "";
}
