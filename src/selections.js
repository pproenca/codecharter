import { randomUUID } from "node:crypto";
import { clampBounds, intersects, normalizeRect } from "./geometry.js";
import { precisionForLevel } from "./levels.js";

export function resolveSelection(codemap, selection) {
  const level = selection.level ?? "file";
  const geometry = normalizeSelectionGeometry(selection.geometry);
  const targetTypes = targetTypesForLevel(level);
  const targets = [];

  if (targetTypes.has("folder")) {
    for (const folder of Object.values(codemap.folders)) {
      if (folder.path !== "" && intersects(geometry.bounds, folder.bounds)) {
        targets.push(resolvedTarget(folder, "folder", level));
      }
    }
  }

  if (targetTypes.has("file")) {
    for (const file of Object.values(codemap.files)) {
      if (intersects(geometry.bounds, file.bounds)) {
        targets.push(resolvedTarget(file, "file", level));
      }
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

function targetTypesForLevel(level) {
  if (level === "world" || level === "region" || level === "folder") return new Set(["folder"]);
  return new Set(["file"]);
}
