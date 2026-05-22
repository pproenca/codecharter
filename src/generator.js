import { PROJECTION_AREA_WEIGHT, PROJECTION_LAYOUT_VERSION, PROJECTION_ORDER, PROJECTION_TYPE } from "./district-layout.js";
import { MAP_LEVELS } from "./levels.js";
import { codePlaneDescriptor } from "./geohash.js";
import { scanCodeFiles } from "./scan.js";
import { stabilizeTreeLayout } from "./stability.js";
import { buildFileTree, flattenTree, sortedFiles, sortedFolders } from "./tree.js";
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

export async function generateCodemap({ root, excludePaths = DEFAULT_EXCLUDE_PATHS, previousCodemap } = {}) {
  const scannedFiles = await scanCodeFiles(root, { excludePaths });
  const previousLayout = canReusePreviousLayout(previousCodemap) ? previousCodemap : undefined;
  const tree = stabilizeTreeLayout(layoutTree(buildFileTree(scannedFiles)), previousLayout);
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

function canReusePreviousLayout(previousCodemap) {
  return previousCodemap?.projection?.type === PROJECTION_TYPE
    && previousCodemap.projection.layoutVersion === PROJECTION_LAYOUT_VERSION
    && previousCodemap.projection.mapOrder === PROJECTION_ORDER
    && previousCodemap.projection.areaWeight === PROJECTION_AREA_WEIGHT;
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
