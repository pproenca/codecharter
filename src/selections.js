import { randomUUID } from "node:crypto";
import { createAnnotationHashRoute, createCodemapDeepLink } from "./deep-links.js";
import { clampBounds, intersects, normalizeRect } from "./geometry.js";
import { precisionForLevel } from "./levels.js";
import { resolveAddress } from "./resolver.js";

const SELECTION_EDGE_EPSILON = 1e-12;
const DEFAULT_ANNOTATION_NAME = "Map annotation";
const ANNOTATION_NAME_MAX_LENGTH = 72;

export function resolveSelection(codemap, selection) {
  const level = selection.level ?? "file";
  const geometry = normalizeSelectionGeometry(selection.geometry);
  const targetMode = targetModeForLevel(level);
  const targets = [];

  if (targetMode === "folder") {
    for (const folder of Object.values(codemap.folders)) {
      if (folder.path !== "" && intersects(geometry.bounds, folder.bounds)) {
        targets.push(resolvedTarget(folder, "folder", level));
      }
    }
  }

  if (targetMode === "file") {
    for (const file of Object.values(codemap.files)) {
      if (intersects(geometry.bounds, file.bounds)) {
        targets.push(resolvedTarget(file, "file", level));
      }
    }
  }

  if (targetMode === "lineRange" || targetMode === "tokenRange") {
    for (const file of Object.values(codemap.files)) {
      if (!intersects(geometry.bounds, file.bounds)) continue;
      targets.push(resolvedCodeTarget(codemap, file, geometry.bounds, level, targetMode));
    }
  }

  const coveringSet = [...new Set(targets.map((target) => target.geohash))]
    .sort((a, b) => a.localeCompare(b));

  return {
    geometry,
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

  return {
    type: "rect",
    bounds: clampBounds(normalizeRect(geometry.bounds)),
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
  const lineRange = lineRangeForSelection(file, selectionBounds);
  const tokenRange = targetMode === "tokenRange" ? tokenRangeForSelection(file, selectionBounds) : {};
  const address = resolveAddress(codemap, {
    path: file.path,
    lineStart: lineRange.lineStart,
    lineEnd: lineRange.lineEnd,
    ...tokenRange,
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

function lineRangeForSelection(file, selectionBounds) {
  const top = clampRatio((selectionBounds.y - file.bounds.y) / file.bounds.height);
  const bottom = clampRatio((selectionBounds.y + selectionBounds.height - file.bounds.y) / file.bounds.height);
  const lineCount = Math.max(1, file.lineCount ?? 1);
  const lineStart = startIndexForRatio(top, lineCount);
  const lineEnd = Math.max(lineStart, endIndexForRatio(bottom, lineCount));
  return { lineStart, lineEnd };
}

function tokenRangeForSelection(file, selectionBounds) {
  const left = clampRatio((selectionBounds.x - file.bounds.x) / file.bounds.width);
  const right = clampRatio((selectionBounds.x + selectionBounds.width - file.bounds.x) / file.bounds.width);
  const maxLineLength = Math.max(1, file.maxLineLength ?? 1);
  const columnStart = startIndexForRatio(left, maxLineLength);
  const columnEnd = Math.max(columnStart, endIndexForRatio(right, maxLineLength));
  return { columnStart, columnEnd };
}

function startIndexForRatio(ratio, size) {
  return Math.min(size, Math.floor(ratio * size + SELECTION_EDGE_EPSILON) + 1);
}

function endIndexForRatio(ratio, size) {
  return Math.min(size, Math.max(1, Math.ceil(ratio * size - SELECTION_EDGE_EPSILON)));
}

function targetModeForLevel(level) {
  if (level === "world" || level === "region" || level === "folder") return "folder";
  if (level === "code" || level === "lineRange") return "lineRange";
  if (level === "tokenRange") return "tokenRange";
  return "file";
}

function clampRatio(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
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
  const coveringSet = annotation.coveringSet.length ? annotation.coveringSet.join(", ") : "no geohash coverage";
  const comment = annotation.comment?.trim() || "<empty>";
  return [
    `CodeCharter annotation: ${annotation.deepLink}`,
    `Browser route: ${annotation.browserHash}`,
    `Geohash coverage: ${coveringSet}`,
    `User note: ${comment}`,
    "Inspect this geohash area in CodeCharter. Read only the files needed to answer the note; do not bulk-read every resolved target.",
  ].join("\n");
}

function annotationName(input) {
  const explicit = input.name?.trim();
  if (explicit) return explicit;
  const comment = input.comment?.trim();
  if (!comment) return DEFAULT_ANNOTATION_NAME;
  const firstLine = comment.split(/\r?\n/).find((line) => line.trim())?.trim();
  if (!firstLine) return DEFAULT_ANNOTATION_NAME;
  return firstLine.length > ANNOTATION_NAME_MAX_LENGTH
    ? `${firstLine.slice(0, ANNOTATION_NAME_MAX_LENGTH - 3)}...`
    : firstLine;
}
