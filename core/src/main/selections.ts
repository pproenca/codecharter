/**
 * Drawn selections, annotations, and named addresses over the map.
 *
 * Implements **BR-015** (overlap is in `overlaps.ts`), **BR-020** (annotation
 * name truncation at 72), **BR-028** (spatial-frame corner geohashes), and the
 * geometry validation + level-dispatched resolution. `resolveSelection` is fully
 * deterministic; `createNamedSelection`/`createMapAnnotation` mint a UUID +
 * timestamp.
 */

import { randomUUID } from "node:crypto";
import { objectRecord, objectValues, sortIfNeeded, sortedUniqueStrings } from "./collections.ts";
import { createAnnotationHashRoute, createMapDeepLink } from "./deep-links.ts";
import { codePointToGeo, encodeGeohash } from "./geohash.ts";
import { clampBounds, intersects, normalizeRect } from "./geometry.ts";
import type { Bounds, Point } from "./geometry.ts";
import { precisionForLevel } from "./levels.ts";
import type { MapLevel } from "./levels.ts";
import { codeRangeRequestForSelection } from "./line-coordinate.ts";
import type { NormalizedRange } from "./line-coordinate.ts";
import { resolveAddress } from "./resolver.ts";
import type {
  AddressTargetType,
  CodecharterMap,
  MapFileTarget,
  MapFolderTarget,
  ResolvedAddress,
} from "./resolver.ts";

const DEFAULT_ANNOTATION_NAME = "Map annotation";
const ANNOTATION_NAME_MAX_LENGTH = 72;

export type SelectionGeometry = {
  type: "rect";
  bounds: Bounds;
};

export type SelectionInput = {
  id?: string;
  name?: string;
  comment?: string;
  level?: MapLevel;
  geometry: SelectionGeometry;
};

export type ResolvedSelectionTarget = {
  targetType: AddressTargetType;
  path: string;
  geohash: string;
  bounds: Bounds;
  lineRange?: NormalizedRange;
  tokenRange?: NormalizedRange;
  address?: ResolvedAddress;
};

type SelectionResolver = (
  map: CodecharterMap,
  geometry: SelectionGeometry,
  level: MapLevel,
) => ResolvedSelectionTarget[];

export type SpatialFrame = {
  level: MapLevel;
  precision: number;
  bounds: Bounds;
  corners: Record<CornerName, string>;
};

export type ResolvedSelection = {
  geometry: SelectionGeometry;
  spatialFrame: SpatialFrame;
  coveringSet: string[];
  resolvedTargets: ResolvedSelectionTarget[];
};

export type NamedSelection = ResolvedSelection & {
  id: string;
  name: string;
  kind: "drawnSelection";
  level: MapLevel;
  createdAt: string;
  updatedAt: string;
};

export type MapAnnotation = ResolvedSelection & {
  id: string;
  name: string;
  kind: "mapAnnotation";
  comment: string;
  level: MapLevel;
  createdAt: string;
  updatedAt: string;
  deepLink: string;
  browserHash: string;
  codexPrompt: string;
};

export type NamedAddress = {
  id: string;
  name: string;
  kind: "mapAddress";
  createdAt: string;
  updatedAt: string;
  address: NamedAddressAddress;
};

export type NamedAddressAddress =
  | ResolvedAddress
  | (Partial<ResolvedAddress> & {
      [key: string]: unknown;
    });

type ResolvablePlace = NamedSelection | MapAnnotation;
type CornerName = "northWest" | "northEast" | "southWest" | "southEast";
const CORNER_NAMES: readonly CornerName[] = ["northWest", "northEast", "southWest", "southEast"];

// Level → resolver dispatch table (variable-target dispatch, resolved here).
const SELECTION_RESOLVERS: Map<MapLevel, SelectionResolver> = new Map([
  [
    "world",
    (map, geometry, level) =>
      resolveFolderTargets(map, geometry, level, { includeRoot: true, rootOnly: true }),
  ],
  ["region", resolveFolderTargets],
  ["folder", resolveFolderTargets],
  ["file", resolveFileTargets],
  ["code", (map, geometry, level) => resolveCodeTargets(map, geometry, level, "lineRange")],
  ["lineRange", (map, geometry, level) => resolveCodeTargets(map, geometry, level, "lineRange")],
  ["tokenRange", (map, geometry, level) => resolveCodeTargets(map, geometry, level, "tokenRange")],
]);

/** Resolve a selection's geometry to its covered targets + spatial frame (deterministic). */
export function resolveSelection(
  map: CodecharterMap,
  selection: SelectionInput,
): ResolvedSelection {
  const level = selection.level ?? "file";
  const geometry = normalizeSelectionGeometry(selection.geometry);
  const targets = selectionResolverForLevel(level)(map, geometry, level);

  return {
    geometry,
    spatialFrame: spatialFrameForGeometry(geometry, level),
    coveringSet: sortedUniqueStrings(targets.map((target) => target.geohash)),
    resolvedTargets: sortIfNeeded(targets, compareSelectionTargetPaths),
  };
}

export function createNamedSelection(map: CodecharterMap, input: SelectionInput): NamedSelection {
  const resolved = resolveSelection(map, input);
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

export function createMapAnnotation(map: CodecharterMap, input: SelectionInput): MapAnnotation {
  const resolved = resolveSelection(map, input);
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

export function createNamedAddress(input: {
  id?: string;
  name?: string;
  address: NamedAddressAddress;
}): NamedAddress {
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

export function refreshPlaceResolution(map: CodecharterMap, place: MapAnnotation): MapAnnotation;
export function refreshPlaceResolution(map: CodecharterMap, place: NamedSelection): NamedSelection;
export function refreshPlaceResolution<T>(
  map: CodecharterMap,
  place: T,
): T | NamedSelection | MapAnnotation;
export function refreshPlaceResolution<T>(
  map: CodecharterMap,
  place: T,
): T | NamedSelection | MapAnnotation {
  if (!isResolvablePlace(place)) {
    return place;
  }
  const refreshed = {
    ...place,
    ...resolveSelection(map, {
      level: place.level,
      geometry: place.geometry,
    }),
  };
  return refreshed.kind === "mapAnnotation" ? withAnnotationPrompt(refreshed) : refreshed;
}

function isResolvablePlace(place: unknown): place is ResolvablePlace {
  const record = objectRecord(place);
  if (!record) {
    return false;
  }
  return (
    (record.kind === "drawnSelection" || record.kind === "mapAnnotation") &&
    "level" in record &&
    "geometry" in record
  );
}

function normalizeSelectionGeometry(geometry: SelectionGeometry): SelectionGeometry {
  if (!geometry || geometry.type !== "rect") {
    throw new Error("Only rectangle drawn selections are supported in v1");
  }
  const bounds = clampBounds(normalizeRect(geometry.bounds));
  if (bounds.width <= 0 || bounds.height <= 0) {
    throw new Error("Selection bounds must cover a non-zero area");
  }
  return { type: "rect", bounds };
}

function resolvedTarget(
  target: MapFolderTarget | MapFileTarget,
  targetType: "folder" | "file",
  level: MapLevel,
): ResolvedSelectionTarget {
  const precision = precisionForLevel(level);
  return {
    targetType,
    path: target.path,
    geohash: target.geo.geohash.slice(0, precision),
    bounds: target.bounds,
  };
}

function resolvedCodeTarget(
  map: CodecharterMap,
  file: MapFileTarget,
  selectionBounds: Bounds,
  level: MapLevel,
  targetMode: "lineRange" | "tokenRange",
): ResolvedSelectionTarget {
  const address = resolveAddress(map, {
    path: file.path,
    ...codeRangeRequestForSelection(file, selectionBounds, targetMode),
  });
  const precision = precisionForLevel(level);
  return {
    targetType: address.targetType,
    path: file.path,
    geohash: address.geohash.slice(0, precision),
    bounds: address.bounds,
    ...(address.lineRange === undefined ? {} : { lineRange: address.lineRange }),
    ...(address.tokenRange ? { tokenRange: address.tokenRange } : {}),
    address,
  };
}

function selectionResolverForLevel(level: MapLevel): SelectionResolver {
  const resolver = SELECTION_RESOLVERS.get(level);
  if (!resolver) {
    throw new Error(`Unknown map level: ${level}`);
  }
  return resolver;
}

function resolveFolderTargets(
  map: CodecharterMap,
  geometry: SelectionGeometry,
  level: MapLevel,
  { includeRoot = false, rootOnly = false }: { includeRoot?: boolean; rootOnly?: boolean } = {},
): ResolvedSelectionTarget[] {
  return intersectingTargets(map.folders, geometry.bounds, (folder) => {
    if (!includeRoot && folder.path === "") {
      return null;
    }
    if (rootOnly && folder.path !== "") {
      return null;
    }
    return resolvedTarget(folder, "folder", level);
  });
}

function resolveFileTargets(
  map: CodecharterMap,
  geometry: SelectionGeometry,
  level: MapLevel,
): ResolvedSelectionTarget[] {
  return intersectingTargets(map.files, geometry.bounds, (file) =>
    resolvedTarget(file, "file", level),
  );
}

function resolveCodeTargets(
  map: CodecharterMap,
  geometry: SelectionGeometry,
  level: MapLevel,
  targetMode: "lineRange" | "tokenRange",
): ResolvedSelectionTarget[] {
  return intersectingTargets(map.files, geometry.bounds, (file) =>
    resolvedCodeTarget(map, file, geometry.bounds, level, targetMode),
  );
}

function intersectingTargets<T extends MapFolderTarget | MapFileTarget>(
  targets: Record<string, T>,
  bounds: Bounds,
  resolve: (target: T) => ResolvedSelectionTarget | null,
): ResolvedSelectionTarget[] {
  const resolved: ResolvedSelectionTarget[] = [];
  for (const target of objectValues(targets)) {
    if (!intersects(bounds, target.bounds)) {
      continue;
    }
    const item = resolve(target);
    if (item) {
      resolved.push(item);
    }
  }
  return resolved;
}

function compareSelectionTargetPaths(
  a: ResolvedSelectionTarget,
  b: ResolvedSelectionTarget,
): number {
  return a.path.localeCompare(b.path);
}

function spatialFrameForGeometry(geometry: SelectionGeometry, level: MapLevel): SpatialFrame {
  const { x, y, width, height } = geometry.bounds;
  const precision = precisionForLevel(level);
  const points: Record<CornerName, Point> = {
    northWest: { x, y },
    northEast: { x: x + width, y },
    southWest: { x, y: y + height },
    southEast: { x: x + width, y: y + height },
  };
  return {
    level,
    precision,
    bounds: geometry.bounds,
    corners: cornerGeohashes(points, precision),
  };
}

function cornerGeohashes(
  points: Record<CornerName, Point>,
  precision: number,
): Record<CornerName, string> {
  const corners: Record<CornerName, string> = {
    northWest: "",
    northEast: "",
    southWest: "",
    southEast: "",
  };
  for (const corner of CORNER_NAMES) {
    const geo = codePointToGeo(points[corner]);
    corners[corner] = encodeGeohash(geo.lat, geo.lon, precision);
  }
  return corners;
}

function withAnnotationPrompt(
  annotation: Omit<MapAnnotation, "deepLink" | "browserHash" | "codexPrompt">,
): MapAnnotation {
  const linked = {
    ...annotation,
    deepLink: createMapDeepLink("annotation", annotation.id),
    browserHash: createAnnotationHashRoute(annotation.id),
  };
  return {
    ...linked,
    codexPrompt: codexPromptForAnnotation(linked),
  };
}

function codexPromptForAnnotation(annotation: Omit<MapAnnotation, "codexPrompt">): string {
  const comment = annotation.comment?.trim() || "<empty>";
  const reference = shellSingleQuote(annotation.deepLink);
  return (
    `CodeCharter annotation: ${annotation.deepLink}\n` +
    `Note: ${comment}\n` +
    `Resolve: codecharter --json resolve ${reference}`
  );
}

function shellSingleQuote(value: unknown): string {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function annotationName(input: SelectionInput): string {
  const explicit = input.name?.trim();
  if (explicit) {
    return explicit;
  }
  const comment = input.comment?.trim();
  if (!comment) {
    return DEFAULT_ANNOTATION_NAME;
  }
  const firstLine = firstNonblankLine(comment);
  if (!firstLine) {
    return DEFAULT_ANNOTATION_NAME;
  }
  return firstLine.length > ANNOTATION_NAME_MAX_LENGTH
    ? `${firstLine.slice(0, ANNOTATION_NAME_MAX_LENGTH - 3)}...`
    : firstLine;
}

function firstNonblankLine(value: string): string {
  return (
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}
