import {
  activityPrimaryBounds,
  activityTrailGroups,
  activityTrailPointGroups,
  isLiveActivityEvent,
  organicTrailSegments,
  sortedActivityEvents,
} from "./activity.ts";
import { DISCOVERY_FOG_TEXTURE_STEP_PX } from "./constants.ts";
import { canRenderSourceText, landmarkScore, shouldLabelFile } from "./lod.ts";
import { boundsCenter, normalizeMapPath, pathFromDeepLink } from "./primitives.ts";
/**
 * Fog-of-war / discovery overlay. Files and folders touched by agent activity
 * become "explored"; currently-live ones become "visible"; everything else is
 * "unexplored" and veiled. Fog state ranks visible > explored > unexplored.
 *
 * The pure fog-state derivation, the style helpers, and the discovery-veil /
 * reveal / mycelium drawing primitives all live here. The veil/mask/reveal
 * *orchestration* is the {@link createFogDrawer} factory: it closes over the
 * canvas singletons and the projection/state accessors that `app.ts` owns, so
 * `app.ts` stays a thin shell and this module holds no state model of its own.
 */
import type {
  ActivityEvent,
  ActivityFogOptions,
  ActivityFogState,
  Bounds,
  BoxSize,
  CodecharterMap,
  FogState,
  MapFile,
  MapFolder,
  MapTargetRecord,
  Point,
} from "./types.ts";

export type FileVisualState =
  | "source"
  | "selected"
  | "landmark"
  | "aggregate"
  | "parcel"
  | "hidden";
export type FolderRenderStyle = { fill: string; stroke: string; label: string; lineWidth?: number };
export type OrganicRegionRenderStyle = { fill: string; stroke: string; lineWidth?: number };
export type FileFogStyleOptions = {
  fogState: FogState;
  selected?: boolean;
  visualState: FileVisualState;
  discoveryMode?: boolean;
};
export type RevealStyle = ReturnType<typeof discoveryFogRevealStyle>;
export type FogTrailStyle = { alpha: number; lineWidth: number };
export type DiscoveryFogVeilStyle = ReturnType<typeof discoveryFogVeilStyle>;

export function buildActivityFogState(
  map: CodecharterMap | null | undefined,
  events: ActivityEvent[] | null | undefined,
  options: ActivityFogOptions = {},
): ActivityFogState {
  const files = map?.files ?? {};
  const folders = map?.folders ?? {};
  const fileStates = new Map<string, FogState>();
  const folderStates = new Map<string, FogState>();
  const visitedFiles = new Set<string>();
  const visibleFiles = new Set<string>();

  for (const event of events ?? []) {
    const path = activityEventFilePath(event, files);
    if (!path) {
      continue;
    }
    const markerFogState = event.viewerFogState;
    if (markerFogState) {
      visitedFiles.add(path);
      if (markerFogState === "visible") {
        visibleFiles.add(path);
      }
      continue;
    }
    visitedFiles.add(path);
    if (isLiveActivityEvent(event, options)) {
      visibleFiles.add(path);
    }
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

export function fogStateForFile(
  fog: ActivityFogState | null | undefined,
  fileOrPath: MapFile | string | null | undefined,
  { selected = false } = {},
): FogState {
  if (!fog) {
    return "visible";
  }
  if (selected) {
    return "visible";
  }
  const path = normalizeMapPath(typeof fileOrPath === "string" ? fileOrPath : fileOrPath?.path);
  return fog.files.get(path) ?? "unexplored";
}

export function fogStateForFolder(
  fog: ActivityFogState | null | undefined,
  folderOrPath: MapFolder | string | null | undefined,
  { selected = false } = {},
): FogState {
  if (!fog) {
    return "visible";
  }
  if (selected) {
    return "visible";
  }
  const path = normalizeMapPath(
    typeof folderOrPath === "string" ? folderOrPath : folderOrPath?.path,
  );
  return fog.folders.get(path) ?? "unexplored";
}

export function shouldShowFogLabel(fogState: FogState, { selected = false } = {}): boolean {
  return selected || fogState !== "unexplored";
}

export function shouldShowFogSourceText(fogState: FogState, { selected = false } = {}): boolean {
  return shouldShowFogLabel(fogState, { selected });
}

export function shouldLabelFoggedFile({
  file,
  box,
  scale,
  selected,
  fogState,
}: {
  file: MapFile;
  box: BoxSize;
  scale: number;
  selected?: boolean;
  fogState: FogState;
}) {
  if (!shouldShowFogLabel(fogState, { selected })) {
    return false;
  }
  if (fogState === "explored" && canRenderSourceText(file, box)) {
    if (landmarkScore(file) > 0 && box.width > 76 && box.height > 26) {
      return true;
    }
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

export function discoveryFogRevealStyle({
  visibleFile = false,
  readable = false,
}: { visibleFile?: boolean; readable?: boolean } = {}) {
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

function activityEventFilePath(
  event: ActivityEvent,
  files: MapTargetRecord<MapFile>,
): string | null {
  for (const candidate of [
    event.address?.path,
    event.path,
    pathFromDeepLink(event.address?.deepLink),
  ]) {
    const path = normalizeMapPath(candidate);
    if (path && files[path]) {
      return path;
    }
  }
  return null;
}

function markAncestorFolderFog(
  folderStates: Map<string, FogState>,
  folders: MapTargetRecord<MapFolder>,
  filePath: string,
  fogState: FogState,
): void {
  if (Object.hasOwn(folders, "")) {
    mergeFolderFogState(folderStates, "", fogState);
  }
  for (let index = filePath.indexOf("/"); index !== -1; index = filePath.indexOf("/", index + 1)) {
    const folderPath = filePath.slice(0, index);
    if (Object.hasOwn(folders, folderPath)) {
      mergeFolderFogState(folderStates, folderPath, fogState);
    }
  }
}

function mergeFolderFogState(
  folderStates: Map<string, FogState>,
  folderPath: string,
  fogState: FogState,
): void {
  if (fogStateRank(fogState) > fogStateRank(folderStates.get(folderPath))) {
    folderStates.set(folderPath, fogState);
  }
}

function fogStateRank(fogState: FogState | undefined): number {
  if (fogState === "visible") {
    return 2;
  }
  if (fogState === "explored") {
    return 1;
  }
  return 0;
}

// --- Fog colouring helpers (pure; the discovery overlay re-tints existing styles) ---

export function folderFogStyle(
  style: FolderRenderStyle,
  fogState: FogState,
  depth: number,
  selected: boolean,
  discoveryMode = false,
) {
  if (discoveryMode) {
    return {
      ...style,
      lineWidth: selected ? 2.6 : depth === 1 ? 2.1 : 1,
    };
  }
  if (selected || fogState === "visible") {
    return {
      ...style,
      lineWidth: selected ? 2.6 : depth === 1 ? 2.1 : 1,
    };
  }
  if (fogState === "explored") {
    return {
      fill: depth === 1 ? "rgba(32, 61, 48, 0.2)" : "rgba(32, 61, 48, 0.12)",
      stroke: depth === 1 ? "rgba(133, 163, 142, 0.42)" : "rgba(133, 163, 142, 0.28)",
      label: "rgba(174, 200, 183, 0.72)",
      lineWidth: depth === 1 ? 1.8 : 1,
    };
  }
  return {
    fill: "rgba(2, 6, 10, 0.18)",
    stroke: depth === 1 ? "rgba(90, 111, 98, 0.22)" : "rgba(90, 111, 98, 0.14)",
    label: "rgba(115, 138, 126, 0.36)",
    lineWidth: depth === 1 ? 1.4 : 0.8,
  };
}

export function organicRegionFogStyle(
  style: OrganicRegionRenderStyle,
  fogState: FogState,
  depth: number,
  selected: boolean,
  discoveryMode = false,
) {
  if (discoveryMode) {
    return {
      ...style,
      lineWidth: selected ? 2.8 : depth === 1 ? 2.4 : 1.4,
    };
  }
  if (selected || fogState === "visible") {
    return {
      ...style,
      lineWidth: selected ? 2.8 : depth === 1 ? 2.4 : 1.4,
    };
  }
  if (fogState === "explored") {
    return {
      fill: depth === 1 ? "rgba(42, 75, 57, 0.16)" : "rgba(42, 75, 57, 0.09)",
      stroke: depth === 1 ? "rgba(137, 168, 145, 0.34)" : "rgba(137, 168, 145, 0.24)",
      lineWidth: depth === 1 ? 2 : 1.2,
    };
  }
  return {
    fill: "rgba(2, 6, 10, 0.08)",
    stroke: depth === 1 ? "rgba(91, 112, 100, 0.16)" : "rgba(91, 112, 100, 0.1)",
    lineWidth: depth === 1 ? 1.6 : 0.9,
  };
}

export function fileFogStyle(
  { fogState, selected, visualState, discoveryMode = false }: FileFogStyleOptions,
  viewScale: number,
) {
  if (selected) {
    return {
      fill: "rgba(255, 255, 255, 0.82)",
      stroke: "rgba(180, 84, 24, 0.95)",
      label: "rgba(3, 87, 67, 0.92)",
      lineWidth: 2.6,
    };
  }
  if (discoveryMode) {
    return {
      fill: "rgba(235, 248, 241, 0.48)",
      stroke: visualState === "aggregate" ? "rgba(18, 128, 98, 0.16)" : "rgba(18, 128, 98, 0.34)",
      label: "rgba(3, 87, 67, 0.84)",
      lineWidth: visualState === "aggregate" ? 0.35 : viewScale > 2.2 ? 1 : 0.65,
    };
  }
  if (fogState === "visible") {
    return {
      fill: "rgba(235, 248, 241, 0.48)",
      stroke: visualState === "aggregate" ? "rgba(18, 128, 98, 0.16)" : "rgba(18, 128, 98, 0.34)",
      label: "rgba(3, 87, 67, 0.84)",
      lineWidth: visualState === "aggregate" ? 0.35 : viewScale > 2.2 ? 1 : 0.65,
    };
  }
  if (fogState === "explored") {
    return {
      fill: "rgba(42, 70, 57, 0.42)",
      stroke:
        visualState === "aggregate" ? "rgba(126, 153, 134, 0.18)" : "rgba(126, 153, 134, 0.34)",
      label: "rgba(177, 202, 185, 0.76)",
      lineWidth: visualState === "aggregate" ? 0.35 : viewScale > 2.2 ? 0.9 : 0.55,
    };
  }
  return {
    fill: "rgba(0, 0, 0, 0.9)",
    stroke: visualState === "aggregate" ? "rgba(54, 70, 63, 0.12)" : "rgba(69, 91, 80, 0.24)",
    label: "rgba(106, 126, 116, 0.42)",
    lineWidth: visualState === "aggregate" ? 0.25 : 0.5,
  };
}

// --- Discovery-veil + reveal drawing primitives (pure over their explicit args) ---

export function drawDiscoveryVeil(
  rect: DOMRect,
  targetCtx: CanvasRenderingContext2D,
  integerNoise: (x: number, y: number) => number,
): void {
  const style = discoveryFogVeilStyle();
  const gradient = targetCtx.createLinearGradient(0, 0, rect.width, rect.height);
  gradient.addColorStop(0, `rgba(1, 7, 11, ${style.baseAlpha})`);
  gradient.addColorStop(0.54, `rgba(3, 16, 14, ${style.baseAlpha * 0.96})`);
  gradient.addColorStop(1, `rgba(8, 13, 20, ${style.horizonAlpha})`);
  targetCtx.fillStyle = gradient;
  targetCtx.fillRect(0, 0, rect.width, rect.height);

  drawDiscoveryVeilTexture(rect, style, targetCtx, integerNoise);

  const vignette = targetCtx.createRadialGradient(
    rect.width * 0.48,
    rect.height * 0.48,
    0,
    rect.width * 0.5,
    rect.height * 0.5,
    Math.max(rect.width, rect.height) * 0.72,
  );
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.22)");
  targetCtx.fillStyle = vignette;
  targetCtx.fillRect(0, 0, rect.width, rect.height);
}

export function drawDiscoveryVeilTexture(
  rect: DOMRect,
  style: DiscoveryFogVeilStyle,
  targetCtx: CanvasRenderingContext2D,
  integerNoise: (x: number, y: number) => number,
): void {
  const step = style.textureStep;
  targetCtx.save();
  targetCtx.fillStyle = `rgba(190, 244, 216, ${style.textureAlpha})`;
  for (let y = -step; y < rect.height + step; y += step) {
    const row = Math.floor(y / step);
    for (let x = -step; x < rect.width + step; x += step) {
      const column = Math.floor(x / step);
      const unit = integerNoise(column, row);
      if (unit < 0.52) {
        continue;
      }
      const size = 1 + unit * 1.8;
      const offsetX = (integerNoise(column + 19, row - 7) - 0.5) * step * 0.44;
      const offsetY = (integerNoise(column - 11, row + 23) - 0.5) * step * 0.44;
      targetCtx.globalAlpha = style.textureAlpha * (0.35 + unit * 0.75);
      targetCtx.fillRect(x + offsetX, y + offsetY, size, size);
    }
  }
  targetCtx.restore();
}

export function strokeFogTrail(
  targetCtx: CanvasRenderingContext2D,
  points: Point[],
  { alpha, lineWidth }: FogTrailStyle,
  viewScale: number,
): void {
  targetCtx.strokeStyle = `rgba(0, 0, 0, ${alpha})`;
  targetCtx.lineWidth = lineWidth;
  targetCtx.beginPath();
  if (drawMyceliumPathForContext(targetCtx, points, viewScale)) {
    targetCtx.stroke();
  }
}

export function drawReadableFogReveal(
  box: Bounds,
  { alpha, padding }: RevealStyle,
  targetCtx: CanvasRenderingContext2D,
  clientWidth: number,
  clientHeight: number,
): void {
  const x = Math.max(0, box.x - padding);
  const y = Math.max(0, box.y - padding);
  const right = Math.min(clientWidth, box.x + box.width + padding);
  const bottom = Math.min(clientHeight, box.y + box.height + padding);
  if (right <= x || bottom <= y) {
    return;
  }

  targetCtx.save();
  targetCtx.filter = "blur(10px)";
  targetCtx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
  targetCtx.fillRect(x, y, right - x, bottom - y);
  targetCtx.restore();
}

export function drawFogReveal(
  key: string,
  box: Bounds,
  { alpha, padding, core, mid, lobes = 3 }: RevealStyle,
  targetCtx: CanvasRenderingContext2D,
  hashUnit: (value: string) => number,
): void {
  const radiusX = Math.max(18, box.width / 2 + padding);
  const radiusY = Math.max(18, box.height / 2 + padding);
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  drawFogRevealGradient({ x: centerX, y: centerY, radiusX, radiusY, alpha, core, mid }, targetCtx);

  for (let index = 0; index < lobes; index += 1) {
    const angle = hashUnit(`${key}:fog-angle:${index}`) * Math.PI * 2;
    const distance = 0.16 + hashUnit(`${key}:fog-distance:${index}`) * 0.2;
    const lobeRadiusX = radiusX * (0.46 + hashUnit(`${key}:fog-rx:${index}`) * 0.18);
    const lobeRadiusY = radiusY * (0.46 + hashUnit(`${key}:fog-ry:${index}`) * 0.18);
    drawFogRevealGradient(
      {
        x: centerX + Math.cos(angle) * radiusX * distance,
        y: centerY + Math.sin(angle) * radiusY * distance,
        radiusX: lobeRadiusX,
        radiusY: lobeRadiusY,
        alpha: alpha * 0.28,
        core: 0.2,
        mid: 0.72,
      },
      targetCtx,
    );
  }
}

export function drawFogRevealGradient(
  {
    x,
    y,
    radiusX,
    radiusY,
    alpha,
    core,
    mid,
  }: {
    x: number;
    y: number;
    radiusX: number;
    radiusY: number;
    alpha: number;
    core: number;
    mid: number;
  },
  targetCtx: CanvasRenderingContext2D,
): void {
  targetCtx.save();
  targetCtx.translate(x, y);
  targetCtx.scale(radiusX, radiusY);
  const gradient = targetCtx.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, `rgba(0, 0, 0, ${alpha})`);
  gradient.addColorStop(core, `rgba(0, 0, 0, ${alpha * 0.94})`);
  gradient.addColorStop(mid, `rgba(0, 0, 0, ${alpha * 0.42})`);
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  targetCtx.fillStyle = gradient;
  targetCtx.beginPath();
  targetCtx.arc(0, 0, 1, 0, Math.PI * 2);
  targetCtx.fill();
  targetCtx.restore();
}

export function drawMyceliumPathForContext(
  targetCtx: CanvasRenderingContext2D,
  points: Point[],
  viewScale: number,
): boolean {
  if (points.length < 2) {
    return false;
  }

  const minDistance = Math.min(14, Math.max(6, viewScale * 2.2));
  const segments = organicTrailSegments(points, { minDistance });
  if (segments.length === 0) {
    return false;
  }

  const first = segments[0];
  if (!first) {
    return false;
  }
  targetCtx.moveTo(first.start.x, first.start.y);
  for (const segment of segments) {
    targetCtx.bezierCurveTo(
      segment.control1.x,
      segment.control1.y,
      segment.control2.x,
      segment.control2.y,
      segment.end.x,
      segment.end.y,
    );
  }
  return true;
}

function expandedFogBox(box: Bounds, padding: number): Bounds {
  return {
    x: box.x - padding,
    y: box.y - padding,
    width: box.width + padding * 2,
    height: box.height + padding * 2,
  };
}

// --- Discovery-overlay orchestration (closes over the canvas + projection deps) ---

export type FogDrawerDeps = {
  getActivityFog: () => ActivityFogState | null;
  getActivity: () => ActivityEvent[];
  getMap: () => CodecharterMap | null;
  getViewScale: () => number;
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  fogMaskCtx: CanvasRenderingContext2D;
  fogMaskCanvas: HTMLCanvasElement;
  fogLayerCtx: CanvasRenderingContext2D;
  fogLayerCanvas: HTMLCanvasElement;
  fogVeilCtx: CanvasRenderingContext2D;
  fogVeilCanvas: HTMLCanvasElement;
  getFogVeilCacheKey: () => string;
  setFogVeilCacheKey: (key: string) => void;
  screenBounds: (bounds: Bounds) => Bounds;
  visible: (box: Bounds) => boolean;
  worldToScreen: (point: Point) => Point;
  hashUnit: (value: string) => number;
  integerNoise: (x: number, y: number) => number;
  fogMaskScale: number;
};

export type FogDrawer = ReturnType<typeof createFogDrawer>;

export function createFogDrawer(deps: FogDrawerDeps) {
  function drawDiscoveryFogOverlay(rect: DOMRect): void {
    buildDiscoveryFogMask(rect);

    deps.fogLayerCtx.save();
    deps.fogLayerCtx.clearRect(0, 0, rect.width, rect.height);
    drawCachedDiscoveryVeil(rect, deps.fogLayerCtx);

    deps.fogLayerCtx.globalCompositeOperation = "destination-out";
    deps.fogLayerCtx.drawImage(deps.fogMaskCanvas, 0, 0, rect.width, rect.height);
    deps.fogLayerCtx.restore();

    deps.ctx.save();
    deps.ctx.drawImage(deps.fogLayerCanvas, 0, 0, rect.width, rect.height);
    deps.ctx.restore();
  }

  function drawCachedDiscoveryVeil(rect: DOMRect, targetCtx: CanvasRenderingContext2D): void {
    const dpr = window.devicePixelRatio || 1;
    const cacheKey = `${rect.width}:${rect.height}:${dpr}`;
    if (deps.getFogVeilCacheKey() !== cacheKey) {
      deps.fogVeilCtx.save();
      deps.fogVeilCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      deps.fogVeilCtx.clearRect(0, 0, rect.width, rect.height);
      drawDiscoveryVeil(rect, deps.fogVeilCtx, deps.integerNoise);
      deps.fogVeilCtx.restore();
      deps.setFogVeilCacheKey(cacheKey);
    }
    targetCtx.drawImage(deps.fogVeilCanvas, 0, 0, rect.width, rect.height);
  }

  function buildDiscoveryFogMask(rect: DOMRect): void {
    deps.fogMaskCtx.save();
    deps.fogMaskCtx.setTransform(
      (window.devicePixelRatio || 1) * deps.fogMaskScale,
      0,
      0,
      (window.devicePixelRatio || 1) * deps.fogMaskScale,
      0,
      0,
    );
    deps.fogMaskCtx.clearRect(0, 0, rect.width, rect.height);
    deps.fogMaskCtx.globalCompositeOperation = "source-over";
    drawDiscoveryTrailMask(deps.fogMaskCtx);
    drawDiscoveryFogReveals(deps.fogMaskCtx);
    deps.fogMaskCtx.restore();
  }

  function drawDiscoveryFogReveals(targetCtx: CanvasRenderingContext2D): void {
    const fog = deps.getActivityFog();
    if (!fog) {
      return;
    }
    const viewScale = deps.getViewScale();
    for (const path of fog.visitedFiles) {
      const file = deps.getMap()?.files?.[path];
      if (!file?.bounds) {
        continue;
      }
      const box = deps.screenBounds(file.bounds);
      const visibleFile = fog.visibleFiles.has(path);
      const readable = viewScale > 2 && canRenderSourceText(file, box);
      const revealStyle = discoveryFogRevealStyle({ visibleFile, readable });
      if (!deps.visible(expandedFogBox(box, revealStyle.padding + 14))) {
        continue;
      }
      if (readable) {
        drawReadableFogReveal(
          box,
          revealStyle,
          targetCtx,
          deps.canvas.clientWidth,
          deps.canvas.clientHeight,
        );
      } else {
        drawFogReveal(path, box, revealStyle, targetCtx, deps.hashUnit);
      }
    }
  }

  function drawDiscoveryTrailMask(targetCtx: CanvasRenderingContext2D): void {
    const events = sortedActivityEvents(deps.getActivity());
    if (events.length < 2) {
      return;
    }
    const trailPointGroups = activityTrailGroups(events, { presorted: true }).flatMap(
      (agentEvents) => activityTrailPointGroups(trailPoints(agentEvents)),
    );
    targetCtx.save();
    targetCtx.lineCap = "round";
    targetCtx.lineJoin = "round";
    targetCtx.filter = "blur(14px)";
    const viewScale = deps.getViewScale();
    for (const points of trailPointGroups) {
      strokeFogTrail(targetCtx, points, { alpha: 0.12, lineWidth: 88 }, viewScale);
    }
    targetCtx.filter = "none";
    for (const points of trailPointGroups) {
      strokeFogTrail(targetCtx, points, { alpha: 0.1, lineWidth: 42 }, viewScale);
    }
    targetCtx.restore();
  }

  function trailPoints(events: ActivityEvent[]): Point[] {
    const points: Point[] = [];
    for (const event of events) {
      const bounds = activityPrimaryBounds(event);
      if (bounds) {
        points.push(deps.worldToScreen(boundsCenter(bounds)));
      }
    }
    return points;
  }

  return { drawDiscoveryFogOverlay };
}
