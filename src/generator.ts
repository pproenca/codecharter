import { PROJECTION_AREA_WEIGHT, PROJECTION_LAYOUT_VERSION, PROJECTION_ORDER, PROJECTION_TYPE } from "./district-layout.ts";
import { MAP_LEVELS } from "./levels.ts";
import { codePlaneDescriptor } from "./geohash.ts";
import { scanCodeFiles } from "./scan.ts";
import { stabilizeTreeLayout } from "./stability.ts";
import { buildFileTree, flattenTree, sortedChildren, sortedFiles, sortedFolders } from "./tree.ts";
import { layoutTree } from "./treemap.ts";
import type { Bounds } from "./geometry.js";
import type { CodePlaneDescriptor, GeohashedCoordinate } from "./geohash.js";
import type { MapLevel } from "./levels.js";
import type { PreviousCodemapLayout } from "./stability.js";
import type { FileNode, FolderNode, FlattenedTree, LayoutBounds, MapNode } from "./tree.js";

const DEFAULT_EXCLUDE_PATHS = [
  ".codecharter/codecharter.json",
  "codecharter.json",
  "codemap.json",
  ".codecharter/config.json",
  ".codecharter/activity.jsonl",
  ".codecharter/named-places.json",
  ".codex/hooks.json",
  ".codex/hooks/codecharter-codex-hook.mjs",
  ".agents/skills/codecharter/SKILL.md",
  ".agents/skills/codecharter/agents/openai.yaml",
];
const MIN_STABLE_ROOT_OCCUPANCY = 0.65;
const MIN_STABLE_TO_FRESH_OCCUPANCY_RATIO = 0.8;
const MAX_OBSOLETE_ROOT_AREA = 0.18;

export type GenerateCodemapOptions = {
  root: string;
  excludePaths?: string[];
  previousCodemap?: PreviousCodemap | null;
};

export type CodemapProjection = {
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

export type GeneratedCodemap = {
  version: 1;
  projection: CodemapProjection;
  mapLevels: Readonly<Record<MapLevel, number>>;
  codePlane: CodePlaneDescriptor;
  folders: Record<string, SerializedFolder>;
  files: Record<string, SerializedFile>;
};

type PreviousCodemap = PreviousCodemapLayout & {
  projection?: {
    type?: string;
    layoutVersion?: number;
    mapOrder?: string;
    areaWeight?: string;
  };
};

export async function generateCodemap({
  root,
  excludePaths = DEFAULT_EXCLUDE_PATHS,
  previousCodemap,
}: GenerateCodemapOptions): Promise<GeneratedCodemap> {
  const scannedFiles = await scanCodeFiles(root, { excludePaths });
  const freshTree = layoutTree(buildFileTree(scannedFiles));
  const previousLayout = canReusePreviousLayout(previousCodemap, freshTree) ? previousCodemap : undefined;
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
    folders: serializeFolders(folders),
    files: serializeFiles(files),
  };
}

function canReusePreviousLayout(previousCodemap: PreviousCodemap | null | undefined, freshTree: FolderNode): previousCodemap is PreviousCodemap {
  return previousCodemap?.projection?.type === PROJECTION_TYPE
    && previousCodemap.projection.layoutVersion === PROJECTION_LAYOUT_VERSION
    && previousCodemap.projection.mapOrder === PROJECTION_ORDER
    && previousCodemap.projection.areaWeight === PROJECTION_AREA_WEIGHT
    && !previousRootLayoutIsSparse(previousCodemap, freshTree);
}

function previousRootLayoutIsSparse(previousCodemap: PreviousCodemap, freshTree: FolderNode): boolean {
  if (obsoleteRootChildArea(previousCodemap, freshTree) > MAX_OBSOLETE_ROOT_AREA) return true;
  const previousOccupancy = rootChildOccupancy(previousCodemap);
  const freshOccupancy = rootTreeChildOccupancy(freshTree);
  if (!Number.isFinite(previousOccupancy) || !Number.isFinite(freshOccupancy)) return false;
  return previousOccupancy < MIN_STABLE_ROOT_OCCUPANCY
    && previousOccupancy < freshOccupancy * MIN_STABLE_TO_FRESH_OCCUPANCY_RATIO;
}

function obsoleteRootChildArea(previousCodemap: PreviousCodemap, freshTree: FolderNode): number {
  const rootArea = boundsArea(previousCodemap?.folders?.[""]?.bounds);
  if (rootArea <= 0) return 0;
  const currentPaths = new Set<string>();
  for (const child of sortedChildren(freshTree)) currentPaths.add(child.path);

  let obsoleteArea = 0;
  for (const path of previousCodemap?.folders?.[""]?.children?.folders ?? []) {
    if (!currentPaths.has(path)) obsoleteArea += boundsArea(previousCodemap.folders?.[path]?.bounds);
  }
  for (const path of previousCodemap?.folders?.[""]?.children?.files ?? []) {
    if (!currentPaths.has(path)) obsoleteArea += boundsArea(previousCodemap.files?.[path]?.bounds);
  }
  return obsoleteArea / rootArea;
}

function rootChildOccupancy(codemap: PreviousCodemap): number {
  const root = codemap?.folders?.[""];
  if (!root?.bounds) return Number.NaN;
  const rootArea = boundsArea(root.bounds);
  if (rootArea <= 0) return Number.NaN;
  let childArea = 0;
  for (const path of root.children?.folders ?? []) {
    childArea += boundsArea(codemap.folders?.[path]?.bounds);
  }
  for (const path of root.children?.files ?? []) {
    childArea += boundsArea(codemap.files?.[path]?.bounds);
  }
  return childArea / rootArea;
}

function rootTreeChildOccupancy(root: FolderNode): number {
  const rootArea = boundsArea(root?.bounds);
  if (rootArea <= 0) return Number.NaN;
  let childArea = 0;
  for (const child of sortedChildren(root)) childArea += boundsArea(child.bounds);
  return childArea / rootArea;
}

function boundsArea(bounds: LayoutBounds | Bounds | undefined): number {
  if (!bounds) return 0;
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
      folders: childPaths(sortedFolders(folder)),
      files: childPaths(sortedFiles(folder)),
    },
    ...(folder.growthArea === undefined ? {} : { growthArea: folder.growthArea }),
  };
}

function childPaths(children: MapNode[]): string[] {
  const paths: string[] = [];
  for (const child of children) paths.push(child.path);
  return paths;
}

function serializeFolders(folders: FlattenedTree["folders"]): Record<string, SerializedFolder> {
  const serialized: Record<string, SerializedFolder> = {};
  for (const path in folders) {
    if (!Object.hasOwn(folders, path)) continue;
    const folder = folders[path];
    if (folder) serialized[path] = serializeFolder(folder);
  }
  return serialized;
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

function serializeFiles(files: FlattenedTree["files"]): Record<string, SerializedFile> {
  const serialized: Record<string, SerializedFile> = {};
  for (const path in files) {
    if (!Object.hasOwn(files, path)) continue;
    const file = files[path];
    if (file) serialized[path] = serializeFile(file);
  }
  return serialized;
}

function requiredBounds(node: FileNode | FolderNode): Bounds {
  if (!node.bounds) throw new Error(`Missing layout bounds for ${node.path || "."}`);
  return node.bounds;
}

function requiredGeo(node: FileNode | FolderNode): GeohashedCoordinate {
  if (!node.geo) throw new Error(`Missing geohash address for ${node.path || "."}`);
  return node.geo;
}
