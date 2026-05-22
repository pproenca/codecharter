import { randomUUID } from "node:crypto";
import { createAnnotationHashRoute, createCodemapDeepLink } from "./deep-links.ts";
import { codePointToGeo, encodeGeohash } from "./geohash.ts";
import { clampBounds, intersects, normalizeRect } from "./geometry.ts";
import { precisionForLevel } from "./levels.ts";
import { codeRangeRequestForSelection } from "./line-coordinate.ts";
import { resolveAddress } from "./resolver.ts";
import type { Bounds, Point } from "./geometry.js";
import type { MapLevel } from "./levels.js";
import type {
  AddressTargetType,
  CodecharterCodemap,
  MapFileTarget,
  MapFolderTarget,
  ResolvedAddress,
} from "./resolver.js";
import type { NormalizedRange } from "./line-coordinate.js";

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
  codemap: CodecharterCodemap,
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
  address: ResolvedAddress | Record<string, unknown>;
};

type ResolvablePlace = NamedSelection | MapAnnotation;
type NamedPlace = ResolvablePlace | NamedAddress;
type CornerName = "northWest" | "northEast" | "southWest" | "southEast";

const SELECTION_RESOLVERS: Map<MapLevel, SelectionResolver> = new Map([
  ["world", (codemap, geometry, level) => resolveFolderTargets(codemap, geometry, level, { includeRoot: true, rootOnly: true })],
  ["region", resolveFolderTargets],
  ["folder", resolveFolderTargets],
  ["file", resolveFileTargets],
  ["code", (codemap, geometry, level) => resolveCodeTargets(codemap, geometry, level, "lineRange")],
  ["lineRange", (codemap, geometry, level) => resolveCodeTargets(codemap, geometry, level, "lineRange")],
  ["tokenRange", (codemap, geometry, level) => resolveCodeTargets(codemap, geometry, level, "tokenRange")],
]);

export function resolveSelection(codemap: CodecharterCodemap, selection: SelectionInput): ResolvedSelection {
  const level = selection.level ?? "file";
  const geometry = normalizeSelectionGeometry(selection.geometry);
  const targets = selectionResolverForLevel(level)(codemap, geometry, level);

  const coveringSet = sortedUniqueGeohashes(targets);

  return {
    geometry,
    spatialFrame: spatialFrameForGeometry(geometry, level),
    coveringSet,
    resolvedTargets: targetsAreSorted(targets) ? targets : targets.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export function createNamedSelection(codemap: CodecharterCodemap, input: SelectionInput): NamedSelection {
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

export function createMapAnnotation(codemap: CodecharterCodemap, input: SelectionInput): MapAnnotation {
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

export function createNamedAddress(input: { id?: string; name?: string; address: ResolvedAddress | Record<string, unknown> }): NamedAddress {
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

export function refreshPlaceResolution(codemap: CodecharterCodemap, place: MapAnnotation): MapAnnotation;
export function refreshPlaceResolution(codemap: CodecharterCodemap, place: NamedSelection): NamedSelection;
export function refreshPlaceResolution<T>(codemap: CodecharterCodemap, place: T): T | NamedSelection | MapAnnotation;
export function refreshPlaceResolution<T>(codemap: CodecharterCodemap, place: T): T | NamedSelection | MapAnnotation {
  if (!isResolvablePlace(place)) return place;
  const refreshed = {
    ...place,
    ...resolveSelection(codemap, {
      level: place.level,
      geometry: place.geometry,
    }),
  };
  return refreshed.kind === "mapAnnotation" ? withAnnotationPrompt(refreshed) : refreshed;
}

function isResolvablePlace(place: unknown): place is ResolvablePlace {
  return typeof place === "object"
    && place !== null
    && ("kind" in place)
    && ((place as { kind?: unknown }).kind === "drawnSelection" || (place as { kind?: unknown }).kind === "mapAnnotation")
    && "level" in place
    && "geometry" in place;
}

function normalizeSelectionGeometry(geometry: SelectionGeometry): SelectionGeometry {
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

function resolvedTarget(target: MapFolderTarget | MapFileTarget, targetType: "folder" | "file", level: MapLevel): ResolvedSelectionTarget {
  const precision = precisionForLevel(level);
  return {
    targetType,
    path: target.path,
    geohash: target.geo.geohash.slice(0, precision),
    bounds: target.bounds,
  };
}

function resolvedCodeTarget(
  codemap: CodecharterCodemap,
  file: MapFileTarget,
  selectionBounds: Bounds,
  level: MapLevel,
  targetMode: "lineRange" | "tokenRange",
): ResolvedSelectionTarget {
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
    ...(address.lineRange === undefined ? {} : { lineRange: address.lineRange }),
    ...(address.tokenRange ? { tokenRange: address.tokenRange } : {}),
    address,
  };
}

function selectionResolverForLevel(level: MapLevel): SelectionResolver {
  const resolver = SELECTION_RESOLVERS.get(level);
  if (!resolver) throw new Error(`Unknown map level: ${level}`);
  return resolver;
}

function resolveFolderTargets(
  codemap: CodecharterCodemap,
  geometry: SelectionGeometry,
  level: MapLevel,
  { includeRoot = false, rootOnly = false }: { includeRoot?: boolean; rootOnly?: boolean } = {},
): ResolvedSelectionTarget[] {
  return intersectingTargets(codemap.folders, geometry.bounds, (folder) => {
    if (!includeRoot && folder.path === "") return null;
    if (rootOnly && folder.path !== "") return null;
    return resolvedTarget(folder, "folder", level);
  });
}

function resolveFileTargets(codemap: CodecharterCodemap, geometry: SelectionGeometry, level: MapLevel): ResolvedSelectionTarget[] {
  return intersectingTargets(codemap.files, geometry.bounds, (file) => resolvedTarget(file, "file", level));
}

function resolveCodeTargets(
  codemap: CodecharterCodemap,
  geometry: SelectionGeometry,
  level: MapLevel,
  targetMode: "lineRange" | "tokenRange",
): ResolvedSelectionTarget[] {
  return intersectingTargets(codemap.files, geometry.bounds, (file) => resolvedCodeTarget(codemap, file, geometry.bounds, level, targetMode));
}

function intersectingTargets<T extends MapFolderTarget | MapFileTarget>(
  targets: Record<string, T>,
  bounds: Bounds,
  resolve: (target: T) => ResolvedSelectionTarget | null,
): ResolvedSelectionTarget[] {
  const resolved: ResolvedSelectionTarget[] = [];
  for (const target of objectValues(targets)) {
    if (!intersects(bounds, target.bounds)) continue;
    const item = resolve(target);
    if (item) resolved.push(item);
  }
  return resolved;
}

function sortedUniqueGeohashes(targets: ResolvedSelectionTarget[]): string[] {
  const geohashes = new Set<string>();
  for (const target of targets) geohashes.add(target.geohash);
  const sorted: string[] = [];
  for (const geohash of geohashes) sorted.push(geohash);
  return stringsAreSorted(sorted) ? sorted : sorted.sort((a, b) => a.localeCompare(b));
}

function stringsAreSorted(values: string[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous !== undefined && current !== undefined && previous.localeCompare(current) > 0) return false;
  }
  return true;
}

function targetsAreSorted(targets: ResolvedSelectionTarget[]): boolean {
  for (let index = 1; index < targets.length; index += 1) {
    const previous = targets[index - 1];
    const current = targets[index];
    if (previous && current && previous.path.localeCompare(current.path) > 0) return false;
  }
  return true;
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

function cornerGeohashes(points: Record<CornerName, Point>, precision: number): Record<CornerName, string> {
  const corners = {} as Record<CornerName, string>;
  for (const corner of Object.keys(points) as CornerName[]) {
    const geo = codePointToGeo(points[corner]);
    corners[corner] = encodeGeohash(geo.lat, geo.lon, precision);
  }
  return corners;
}

function* objectValues<T>(values: Record<string, T>): Generator<T> {
  for (const key in values) {
    if (!Object.hasOwn(values, key)) continue;
    const value = values[key];
    if (value !== undefined) yield value;
  }
}

function withAnnotationPrompt(annotation: Omit<MapAnnotation, "deepLink" | "browserHash" | "codexPrompt">): MapAnnotation {
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

function codexPromptForAnnotation(annotation: Omit<MapAnnotation, "codexPrompt">): string {
  const comment = annotation.comment?.trim() || "<empty>";
  const reference = doubleQuote(annotation.deepLink);
  return `CodeCharter annotation: ${annotation.deepLink}\n`
    + `Note: ${comment}\n`
    + `Resolve: npx --yes codecharter@latest --json resolve ${reference}`;
}

function doubleQuote(value: unknown): string {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function formatBounds(bounds: Bounds): string {
  return `x=${formatNumber(bounds.x)}, y=${formatNumber(bounds.y)}, width=${formatNumber(bounds.width)}, height=${formatNumber(bounds.height)}`;
}

function formatNumber(value: number): string {
  return Number.parseFloat(value.toFixed(6)).toString();
}

function annotationName(input: SelectionInput): string {
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

function firstNonblankLine(value: string): string {
  let start = 0;
  for (let index = 0; index <= value.length; index += 1) {
    if (index < value.length && value[index] !== "\n") continue;
    const line = value.slice(start, value[index - 1] === "\r" ? index - 1 : index).trim();
    if (line) return line;
    start = index + 1;
  }
  return "";
}
