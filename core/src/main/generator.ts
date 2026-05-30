/**
 * Map generator — orchestrates the whole pipeline: scan → build tree →
 * lay out → stabilize against the previous map → serialize.
 *
 * Implements **BR-050** (fresh vs incremental regeneration) and **BR-014** (the
 * sparse-root reuse heuristic: 0.65 / 0.8 / 0.18). Output is the
 * `codecharter.json` map, byte-deterministic for identical input.
 */

import {
  PROJECTION_AREA_WEIGHT,
  PROJECTION_LAYOUT_VERSION,
  PROJECTION_ORDER,
  PROJECTION_TYPE,
} from "./district-layout.ts";
import type { CodePlaneDescriptor, GeohashedCoordinate } from "./geo-types.ts";
import { codePlaneDescriptor } from "./geohash.ts";
import type { Bounds } from "./geometry.ts";
import { MAP_LEVELS } from "./levels.ts";
import type { MapLevel } from "./levels.ts";
import {
  ACTIVITY_ARCHIVE_FILE,
  CONFIG_FILE,
  HOOK_SHIM_FILE,
  HOOKS_JSON_FILE,
  LEGACY_MAP_FILE,
  MAP_FILE,
  NAMED_PLACES_FILE,
  ROOT_MAP_FILE,
} from "./paths.ts";
import { scanCodeFiles } from "./scan.ts";
import { stabilizeTreeLayout } from "./stability.ts";
import type { PreviousMapLayout } from "./stability.ts";
import { buildFileTree, flattenTree, sortedChildren, sortedFiles, sortedFolders } from "./tree.ts";
import type { FileNode, FolderNode, LayoutBounds } from "./tree.ts";
import { layoutTree } from "./treemap.ts";

const DEFAULT_EXCLUDE_PATHS = [
  MAP_FILE,
  ROOT_MAP_FILE,
  LEGACY_MAP_FILE,
  CONFIG_FILE,
  ACTIVITY_ARCHIVE_FILE,
  NAMED_PLACES_FILE,
  HOOKS_JSON_FILE,
  HOOK_SHIM_FILE,
  ".agents/skills/codecharter/SKILL.md",
  ".agents/skills/codecharter/agents/openai.yaml",
];
const MIN_STABLE_ROOT_OCCUPANCY = 0.65;
const MIN_STABLE_TO_FRESH_OCCUPANCY_RATIO = 0.8;
const MAX_OBSOLETE_ROOT_AREA = 0.18;

export type GenerateMapOptions = {
  root: string;
  excludePaths?: string[];
  previousMap?: PreviousMap | null;
};

export type MapProjection = {
  type: typeof PROJECTION_TYPE;
  layoutVersion: typeof PROJECTION_LAYOUT_VERSION;
  mapOrder: typeof PROJECTION_ORDER;
  inclusion: "gitignore-known-code-extensions";
  areaWeight: typeof PROJECTION_AREA_WEIGHT;
  tileAddressing: "geohash-prefix";
};

export type SerializedFolder = {
  path: string;
  name: string;
  bounds: Bounds;
  geo: GeohashedCoordinate;
  lineCount: number;
  weight: number;
  children: {
    folders: string[];
    files: string[];
  };
  growthArea?: Bounds;
};

export type SerializedFile = {
  path: string;
  name: string;
  extension: string;
  contentType: "code";
  bounds: Bounds;
  geo: GeohashedCoordinate;
  lineCount: number;
  maxLineLength: number;
  weight: number;
};

export type GeneratedMap = {
  version: 1;
  projection: MapProjection;
  mapLevels: Readonly<Record<MapLevel, number>>;
  codePlane: CodePlaneDescriptor;
  folders: Record<string, SerializedFolder>;
  files: Record<string, SerializedFile>;
};

type PreviousMap = PreviousMapLayout & {
  projection?: {
    type?: string;
    layoutVersion?: number;
    mapOrder?: string;
    areaWeight?: string;
  };
};

/** Scan the repo at `root` and produce a fresh or stability-preserving map. */
export async function generateMap({
  root,
  excludePaths = DEFAULT_EXCLUDE_PATHS,
  previousMap,
}: GenerateMapOptions): Promise<GeneratedMap> {
  const scannedFiles = await scanCodeFiles(root, { excludePaths });
  const freshTree = layoutTree(buildFileTree(scannedFiles));
  const previousLayout = canReusePreviousLayout(previousMap, freshTree) ? previousMap : undefined;
  const tree = stabilizeTreeLayout(freshTree, previousLayout);
  const { folders, files } = flattenTree(tree);

  return {
    version: 1,
    projection: {
      type: PROJECTION_TYPE,
      layoutVersion: PROJECTION_LAYOUT_VERSION,
      mapOrder: PROJECTION_ORDER,
      inclusion: "gitignore-known-code-extensions",
      areaWeight: PROJECTION_AREA_WEIGHT,
      tileAddressing: "geohash-prefix",
    },
    mapLevels: MAP_LEVELS,
    codePlane: codePlaneDescriptor(),
    folders: serializeRecord(folders, serializeFolder),
    files: serializeRecord(files, serializeFile),
  };
}

function canReusePreviousLayout(
  previousMap: PreviousMap | null | undefined,
  freshTree: FolderNode,
): previousMap is PreviousMap {
  return (
    previousMap?.projection?.type === PROJECTION_TYPE &&
    previousMap.projection.layoutVersion === PROJECTION_LAYOUT_VERSION &&
    previousMap.projection.mapOrder === PROJECTION_ORDER &&
    previousMap.projection.areaWeight === PROJECTION_AREA_WEIGHT &&
    !previousRootLayoutIsSparse(previousMap, freshTree)
  );
}

function previousRootLayoutIsSparse(previousMap: PreviousMap, freshTree: FolderNode): boolean {
  if (obsoleteRootChildArea(previousMap, freshTree) > MAX_OBSOLETE_ROOT_AREA) {
    return true;
  }
  const previousOccupancy = rootChildOccupancy(previousMap);
  const freshOccupancy = rootTreeChildOccupancy(freshTree);
  if (!Number.isFinite(previousOccupancy) || !Number.isFinite(freshOccupancy)) {
    return false;
  }
  return (
    previousOccupancy < MIN_STABLE_ROOT_OCCUPANCY &&
    previousOccupancy < freshOccupancy * MIN_STABLE_TO_FRESH_OCCUPANCY_RATIO
  );
}

function obsoleteRootChildArea(previousMap: PreviousMap, freshTree: FolderNode): number {
  const rootArea = boundsArea(previousMap?.folders?.[""]?.bounds);
  if (rootArea <= 0) {
    return 0;
  }
  const currentPaths = new Set<string>();
  for (const child of sortedChildren(freshTree)) {
    currentPaths.add(child.path);
  }

  let obsoleteArea = 0;
  for (const path of previousMap?.folders?.[""]?.children?.folders ?? []) {
    if (!currentPaths.has(path)) {
      obsoleteArea += boundsArea(previousMap.folders?.[path]?.bounds);
    }
  }
  for (const path of previousMap?.folders?.[""]?.children?.files ?? []) {
    if (!currentPaths.has(path)) {
      obsoleteArea += boundsArea(previousMap.files?.[path]?.bounds);
    }
  }
  return obsoleteArea / rootArea;
}

function rootChildOccupancy(map: PreviousMap): number {
  const root = map?.folders?.[""];
  if (!root?.bounds) {
    return Number.NaN;
  }
  const rootArea = boundsArea(root.bounds);
  if (rootArea <= 0) {
    return Number.NaN;
  }
  let childArea = 0;
  for (const path of root.children?.folders ?? []) {
    childArea += boundsArea(map.folders?.[path]?.bounds);
  }
  for (const path of root.children?.files ?? []) {
    childArea += boundsArea(map.files?.[path]?.bounds);
  }
  return childArea / rootArea;
}

function rootTreeChildOccupancy(root: FolderNode): number {
  const rootArea = boundsArea(root?.bounds);
  if (rootArea <= 0) {
    return Number.NaN;
  }
  let childArea = 0;
  for (const child of sortedChildren(root)) {
    childArea += boundsArea(child.bounds);
  }
  return childArea / rootArea;
}

function boundsArea(bounds: LayoutBounds | Bounds | undefined): number {
  if (!bounds) {
    return 0;
  }
  return Math.max(0, bounds.width ?? 0) * Math.max(0, bounds.height ?? 0);
}

function serializeFolder(folder: FolderNode): SerializedFolder {
  return {
    path: folder.path,
    name: folder.name,
    bounds: requiredBounds(folder),
    geo: requiredGeo(folder),
    lineCount: folder.lineCount,
    weight: folder.weight,
    children: {
      folders: sortedFolders(folder).map((child) => child.path),
      files: sortedFiles(folder).map((child) => child.path),
    },
    ...(folder.growthArea === undefined ? {} : { growthArea: folder.growthArea }),
  };
}

function serializeFile(file: FileNode): SerializedFile {
  return {
    path: file.path,
    name: file.name,
    extension: file.extension,
    contentType: "code",
    bounds: requiredBounds(file),
    geo: requiredGeo(file),
    lineCount: file.lineCount,
    maxLineLength: file.maxLineLength,
    weight: file.weight,
  };
}

function serializeRecord<T, U>(
  record: Record<string, T>,
  serialize: (value: T) => U,
): Record<string, U> {
  const serialized: Record<string, U> = {};
  for (const [path, value] of Object.entries(record)) {
    serialized[path] = serialize(value);
  }
  return serialized;
}

function requiredBounds(node: FileNode | FolderNode): Bounds {
  if (!node.bounds) {
    throw new Error(`Missing layout bounds for ${node.path || "."}`);
  }
  return node.bounds;
}

function requiredGeo(node: FileNode | FolderNode): GeohashedCoordinate {
  if (!node.geo) {
    throw new Error(`Missing geohash address for ${node.path || "."}`);
  }
  return node.geo;
}
