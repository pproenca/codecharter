import { PROJECTION_AREA_WEIGHT, PROJECTION_LAYOUT_VERSION, PROJECTION_ORDER, PROJECTION_TYPE } from "./district-layout.js";
import { MAP_LEVELS } from "./levels.js";
import { codePlaneDescriptor } from "./geohash.js";
import { scanCodeFiles } from "./scan.js";
import { stabilizeTreeLayout } from "./stability.js";
import { buildFileTree, flattenTree, sortedChildren, sortedFiles, sortedFolders } from "./tree.js";
import { layoutTree } from "./treemap.js";

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

export async function generateCodemap({ root, excludePaths = DEFAULT_EXCLUDE_PATHS, previousCodemap } = {}) {
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

function canReusePreviousLayout(previousCodemap, freshTree) {
  return previousCodemap?.projection?.type === PROJECTION_TYPE
    && previousCodemap.projection.layoutVersion === PROJECTION_LAYOUT_VERSION
    && previousCodemap.projection.mapOrder === PROJECTION_ORDER
    && previousCodemap.projection.areaWeight === PROJECTION_AREA_WEIGHT
    && !previousRootLayoutIsSparse(previousCodemap, freshTree);
}

function previousRootLayoutIsSparse(previousCodemap, freshTree) {
  if (obsoleteRootChildArea(previousCodemap, freshTree) > MAX_OBSOLETE_ROOT_AREA) return true;
  const previousOccupancy = rootChildOccupancy(previousCodemap);
  const freshOccupancy = rootTreeChildOccupancy(freshTree);
  if (!Number.isFinite(previousOccupancy) || !Number.isFinite(freshOccupancy)) return false;
  return previousOccupancy < MIN_STABLE_ROOT_OCCUPANCY
    && previousOccupancy < freshOccupancy * MIN_STABLE_TO_FRESH_OCCUPANCY_RATIO;
}

function obsoleteRootChildArea(previousCodemap, freshTree) {
  const rootArea = boundsArea(previousCodemap?.folders?.[""]?.bounds);
  if (rootArea <= 0) return 0;
  const currentPaths = new Set();
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

function rootChildOccupancy(codemap) {
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

function rootTreeChildOccupancy(root) {
  const rootArea = boundsArea(root?.bounds);
  if (rootArea <= 0) return Number.NaN;
  let childArea = 0;
  for (const child of sortedChildren(root)) childArea += boundsArea(child.bounds);
  return childArea / rootArea;
}

function boundsArea(bounds) {
  if (!bounds) return 0;
  return Math.max(0, bounds.width ?? 0) * Math.max(0, bounds.height ?? 0);
}

function serializeFolder(folder) {
  return {
    path: folder.path,
    name: folder.name,
    bounds: folder.bounds,
    geo: folder.geo,
    lineCount: folder.lineCount,
    weight: folder.weight,
    children: {
      folders: childPaths(sortedFolders(folder)),
      files: childPaths(sortedFiles(folder)),
    },
    growthArea: folder.growthArea,
  };
}

function childPaths(children) {
  const paths = [];
  for (const child of children) paths.push(child.path);
  return paths;
}

function serializeFolders(folders) {
  const serialized = {};
  for (const path in folders) {
    if (!Object.hasOwn(folders, path)) continue;
    const folder = folders[path];
    serialized[path] = serializeFolder(folder);
  }
  return serialized;
}

function serializeFile(file) {
  return {
    path: file.path,
    name: file.name,
    extension: file.extension,
    contentType: "code",
    bounds: file.bounds,
    geo: file.geo,
    lineCount: file.lineCount,
    maxLineLength: file.maxLineLength,
    weight: file.weight,
  };
}

function serializeFiles(files) {
  const serialized = {};
  for (const path in files) {
    if (!Object.hasOwn(files, path)) continue;
    const file = files[path];
    serialized[path] = serializeFile(file);
  }
  return serialized;
}
