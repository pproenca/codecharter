/**
 * Fog-of-war / discovery overlay. Files and folders touched by agent activity
 * become "explored"; currently-live ones become "visible"; everything else is
 * "unexplored" and veiled. Fog state ranks visible > explored > unexplored.
 */
import type {
  ActivityEvent,
  ActivityFogOptions,
  ActivityFogState,
  BoxSize,
  CodecharterCodemap,
  FogState,
  MapFile,
  MapFolder,
  MapTargetRecord,
} from "./types.ts";
import { DISCOVERY_FOG_TEXTURE_STEP_PX } from "./constants.ts";
import { normalizeMapPath } from "./primitives.ts";
import { canRenderSourceText, landmarkScore, shouldLabelFile } from "./lod.ts";
import { isLiveActivityEvent } from "./activity.ts";

export function buildActivityFogState(codemap: CodecharterCodemap | null | undefined, events: ActivityEvent[] | null | undefined, options: ActivityFogOptions = {}): ActivityFogState {
  const files = codemap?.files ?? {};
  const folders = codemap?.folders ?? {};
  const fileStates = new Map<string, FogState>();
  const folderStates = new Map<string, FogState>();
  const visitedFiles = new Set<string>();
  const visibleFiles = new Set<string>();

  for (const event of events ?? []) {
    const path = activityEventFilePath(event, files);
    if (!path) continue;
    visitedFiles.add(path);
    if (isLiveActivityEvent(event, options)) visibleFiles.add(path);
  }

  for (const path of visitedFiles) {
    fileStates.set(path, "explored");
    markAncestorFolderFog(folderStates, folders, path, "explored");
  }

  for (const path of visibleFiles) {
    fileStates.set(path, "visible");
    markAncestorFolderFog(folderStates, folders, path, "visible");
  }

  return {
    files: fileStates,
    folders: folderStates,
    visitedFiles,
    visibleFiles,
  };
}

export function fogStateForFile(fog: ActivityFogState | null | undefined, fileOrPath: MapFile | string | null | undefined, { selected = false } = {}): FogState {
  if (!fog) return "visible";
  if (selected) return "visible";
  const path = normalizeMapPath(typeof fileOrPath === "string" ? fileOrPath : fileOrPath?.path);
  return fog.files.get(path) ?? "unexplored";
}

export function fogStateForFolder(fog: ActivityFogState | null | undefined, folderOrPath: MapFolder | string | null | undefined, { selected = false } = {}): FogState {
  if (!fog) return "visible";
  if (selected) return "visible";
  const path = normalizeMapPath(typeof folderOrPath === "string" ? folderOrPath : folderOrPath?.path);
  return fog.folders.get(path) ?? "unexplored";
}

export function shouldShowFogLabel(fogState: FogState, { selected = false } = {}): boolean {
  return selected || fogState !== "unexplored";
}

export function shouldShowFogSourceText(fogState: FogState, { selected = false } = {}): boolean {
  return shouldShowFogLabel(fogState, { selected });
}

export function shouldLabelFoggedFile({ file, box, scale, selected, fogState }: { file: MapFile; box: BoxSize; scale: number; selected?: boolean; fogState: FogState }) {
  if (!shouldShowFogLabel(fogState, { selected })) return false;
  if (fogState === "explored" && canRenderSourceText(file, box)) {
    if (landmarkScore(file) > 0 && box.width > 76 && box.height > 26) return true;
    return scale > 2.2 && box.width > 78 && box.height > 24;
  }
  return shouldLabelFile({
    file,
    box,
    scale,
    ...(selected === undefined ? {} : { selected }),
  });
}

export function discoveryFogVeilStyle() {
  return {
    baseAlpha: 0.88,
    horizonAlpha: 0.76,
    textureAlpha: 0.035,
    textureStep: DISCOVERY_FOG_TEXTURE_STEP_PX,
  };
}

export function discoveryFogRevealStyle({ visibleFile = false, readable = false }: { visibleFile?: boolean; readable?: boolean } = {}) {
  if (readable) {
    return {
      alpha: visibleFile ? 1 : 0.88,
      core: 0.74,
      lobes: 1,
      mid: 0.98,
      padding: visibleFile ? 68 : 36,
    };
  }

  if (visibleFile) {
    return {
      alpha: 0.96,
      core: 0.72,
      lobes: 1,
      mid: 0.98,
      padding: 64,
    };
  }

  return {
    alpha: 0.28,
    core: 0.32,
    lobes: 1,
    mid: 0.76,
    padding: 28,
  };
}

function activityEventFilePath(event: ActivityEvent, files: MapTargetRecord<MapFile>): string | null {
  for (const candidate of [
    event?.address?.path,
    event?.path,
    pathFromDeepLink(event?.address?.deepLink),
  ]) {
    const path = normalizeMapPath(candidate);
    if (path && files[path]) return path;
  }
  return null;
}

function pathFromDeepLink(deepLink: string | undefined): string {
  if (!deepLink) return "";
  try {
    return new URL(deepLink).searchParams.get("path") ?? "";
  } catch {
    return "";
  }
}

function markAncestorFolderFog(folderStates: Map<string, FogState>, folders: MapTargetRecord<MapFolder>, filePath: string, fogState: FogState): void {
  if (Object.hasOwn(folders, "")) mergeFolderFogState(folderStates, "", fogState);
  for (let index = filePath.indexOf("/"); index !== -1; index = filePath.indexOf("/", index + 1)) {
    const folderPath = filePath.slice(0, index);
    if (Object.hasOwn(folders, folderPath)) mergeFolderFogState(folderStates, folderPath, fogState);
  }
}

function mergeFolderFogState(folderStates: Map<string, FogState>, folderPath: string, fogState: FogState): void {
  if (fogStateRank(fogState) > fogStateRank(folderStates.get(folderPath))) {
    folderStates.set(folderPath, fogState);
  }
}

function fogStateRank(fogState: FogState | undefined): number {
  if (fogState === "visible") return 2;
  if (fogState === "explored") return 1;
  return 0;
}
