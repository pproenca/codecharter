/**
 * Map-geometry drawing: grid, compass rose, folders, organic regions, files,
 * source text, line bands, and named places / annotations. This is the canvas
 * *drawing* counterpart to the pure render-model helpers — it closes over the
 * 2D context, the projection/state accessors that `app.ts` owns, and the shared
 * canvas primitives (`drawRect`, `drawLabel`, `queueLabelInBox`, `drawSelection`)
 * that stay in the shell because `render()` and the overlap/activity draws also
 * use them. The factory builds private `worldToScreen` / `screenBounds` /
 * `visible` / `screenIntersection` from the injected view + viewport accessors,
 * so this module owns no semantic identity model: it only reads the shared
 * `state` through getters and mutates the source caches it owns.
 *
 * The source-text caches (`organicRegionPointsCache`, `sourceLinesByNumberCache`)
 * are module-private to this factory; `app.ts` clears the organic-region cache
 * on map apply through {@link DrawController.clearCaches}.
 */

import { isScreenBoxVisible, screenBoundsForView, worldToScreenPoint } from "./camera.ts";
import { SOURCE_TEXT_MAX_LINES_PER_FRAME, SOURCE_TEXT_PREFETCH_LINES } from "./constants.ts";
import {
  fileFogStyle,
  fogStateForFile,
  fogStateForFolder,
  folderFogStyle,
  organicRegionFogStyle,
  shouldLabelFoggedFile,
  shouldShowFogLabel,
  shouldShowFogSourceText,
} from "./fog.ts";
import {
  canRenderSourceText,
  fileLabelPriority,
  fileVisualState,
  folderDepth,
  folderLabelPriority,
  folderStyle,
  lineHeightForFile,
  organicRegionPoints,
  organicRegionStyle,
  shouldDrawFolder,
  shouldDrawOrganicRegion,
  shouldLabelFolder,
} from "./lod.ts";
import { boundsCenter } from "./primitives.ts";
import {
  cachedSourceRange,
  rememberSourceRange,
  sourceContextRequest,
  sourceRangeCacheKey,
  sourceTextLayoutForBox,
  visibleLineRangeForBox,
} from "./source-panel.ts";
import { folderDisplayName } from "./targets.ts";
import type {
  ActivityFogState,
  Bounds,
  MapAnnotationPlace,
  MapFile,
  MapFolder,
  NamedPlace,
  Point,
  SourceCache,
  SourceRange,
  View,
  Viewport,
} from "./types.ts";

type FrameLabelShape = {
  text: string;
  box: Bounds;
  color: string;
  size: number;
  weight: string;
  priority: number;
};

export type DrawControllerDeps = {
  ctx: CanvasRenderingContext2D;
  /** canvas.clientWidth/clientHeight — used by drawGrid, drawCompassRose, screenIntersection, visibleLineRange. */
  canvasSize: () => Viewport;
  /** frameViewport ?? canvasSize — used by worldToScreen, screenBounds, visible. */
  viewportSize: () => Viewport;
  getView: () => View;
  getMapFolders: () => MapFolder[];
  getMapFiles: () => MapFile[];
  getOrganicRegionFolders: () => Array<{ folder: MapFolder; depth: number }>;
  getActivityFog: () => ActivityFogState | null;
  getNamedPlaces: () => NamedPlace[];
  /** Opaque — only targetType / path / id fields are read. */
  getSelectedTarget: () => { targetType: string; path?: string; id?: string } | null;
  getSourceCache: () => SourceCache;
  getPendingSourceRequests: () => Set<string>;
  /** Wraps controls.showActivity?.checked. */
  isDiscoveryEnabled: () => boolean;
  /** Shared canvas primitive — also used by drawOverlaps, drawActivity, render(). */
  drawRect: (box: Bounds) => void;
  drawLabel: (
    text: string,
    x: number,
    y: number,
    color: string,
    size?: number,
    weight?: string,
  ) => void;
  queueLabelInBox: (label: FrameLabelShape) => void;
  /** Also called from render() for the draft selection. */
  drawSelection: (bounds: Bounds, fill: string, stroke: string, dash: number[]) => void;
  /** Triggers a re-render after a source range fetch resolves (legacy: render(), not requestRender). */
  render: () => void;
  fetchJson: <T = unknown>(url: string) => Promise<T>;
};

export type DrawController = ReturnType<typeof createDrawController>;

/**
 * Truncate a source line to fit `maxChars`, appending an ellipsis when clipped.
 * Pure helper, exported for unit testing; the draw loop calls it per visible
 * line of inline source text.
 */
export function truncateLine(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, Math.max(0, maxChars - 3))}...` : text;
}

export function createDrawController(deps: DrawControllerDeps) {
  const ctx = deps.ctx;
  const organicRegionPointsCache = new Map<string, Point[]>();
  const sourceLinesByNumberCache = new WeakMap<SourceRange, Map<number | string, string>>();

  function clearCaches(): void {
    organicRegionPointsCache.clear();
  }

  function worldToScreen(point: Point): Point {
    return worldToScreenPoint(point, deps.getView(), deps.viewportSize());
  }

  function screenBounds(bounds: Bounds): Bounds {
    return screenBoundsForView(bounds, deps.getView(), deps.viewportSize());
  }

  function visible(box: Bounds): boolean {
    return isScreenBoxVisible(box, deps.viewportSize());
  }

  function screenIntersection(box: Bounds): Bounds | null {
    const { width: clientWidth, height: clientHeight } = deps.canvasSize();
    const x1 = Math.max(0, box.x);
    const y1 = Math.max(0, box.y);
    const x2 = Math.min(clientWidth, box.x + box.width);
    const y2 = Math.min(clientHeight, box.y + box.height);
    if (x2 <= x1 || y2 <= y1) {
      return null;
    }
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }

  function hasGeometryBounds<T extends { geometry?: { bounds?: Bounds } }>(
    target: T | null | undefined,
  ): target is T & { geometry: { bounds: Bounds } } {
    return target?.geometry?.bounds !== undefined;
  }

  function drawGrid(): void {
    const { width: clientWidth, height: clientHeight } = deps.canvasSize();
    const step = 0.1;
    ctx.save();
    ctx.strokeStyle = "rgba(15, 23, 42, 0.12)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i += 1) {
      const p = worldToScreen({ x: i * step, y: i * step });
      ctx.beginPath();
      ctx.moveTo(p.x, 0);
      ctx.lineTo(p.x, clientHeight);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p.y);
      ctx.lineTo(clientWidth, p.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCompassRose(): void {
    const { width: clientWidth, height: clientHeight } = deps.canvasSize();
    ctx.save();
    ctx.fillStyle = "rgba(18, 61, 53, 0.08)";
    ctx.strokeStyle = "rgba(18, 61, 53, 0.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(clientWidth - 44, clientHeight - 44, 22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = "11px Inter, system-ui, sans-serif";
    ctx.fillText("N", clientWidth - 48, clientHeight - 50);
    ctx.fillText("Code Plane", clientWidth - 96, clientHeight - 16);
    ctx.restore();
  }

  function drawFolders(): void {
    const fogEnabled = deps.isDiscoveryEnabled();
    const view = deps.getView();
    const activityFog = deps.getActivityFog();
    const selectedTarget = deps.getSelectedTarget();
    for (const folder of deps.getMapFolders()) {
      if (!folder.path || !folder.bounds) {
        continue;
      }
      const box = screenBounds(folder.bounds);
      if (!visible(box)) {
        continue;
      }
      const depth = folderDepth(folder.path);
      if (!shouldDrawFolder(view.scale, depth, box)) {
        continue;
      }
      const selected =
        selectedTarget?.targetType === "folder" && selectedTarget.path === folder.path;
      const fogState = fogEnabled
        ? fogStateForFolder(activityFog, folder, { selected })
        : "visible";
      const style = folderStyle(folder.path, depth);
      const fogStyle = folderFogStyle(style, fogState, depth, selected, fogEnabled);
      ctx.fillStyle = fogStyle.fill;
      ctx.strokeStyle = fogStyle.stroke;
      ctx.lineWidth = selected ? 2.6 : fogStyle.lineWidth;
      deps.drawRect(box);
      if (shouldShowFogLabel(fogState, { selected }) && shouldLabelFolder(view.scale, depth, box)) {
        deps.queueLabelInBox({
          text: folderDisplayName(folder),
          box,
          color: fogStyle.label,
          size: 13,
          weight: "600",
          priority: folderLabelPriority(depth, box),
        });
      }
    }
  }

  function drawOrganicRegions(): void {
    const fogEnabled = deps.isDiscoveryEnabled();
    const view = deps.getView();
    const activityFog = deps.getActivityFog();
    const selectedTarget = deps.getSelectedTarget();
    for (const { folder, depth } of deps.getOrganicRegionFolders()) {
      if (!folder.bounds) {
        continue;
      }
      const box = screenBounds(folder.bounds);
      if (!visible(box)) {
        continue;
      }
      if (!shouldDrawOrganicRegion(view.scale, depth, box)) {
        continue;
      }
      const points = cachedOrganicRegionPoints(folder.bounds, folder.path, depth);
      if (points.length < 3) {
        continue;
      }
      const style = organicRegionStyle(folder.path, depth);
      const selected =
        selectedTarget?.targetType === "folder" && selectedTarget.path === folder.path;
      const fogState = fogEnabled
        ? fogStateForFolder(activityFog, folder, { selected })
        : "visible";
      const fogStyle = organicRegionFogStyle(style, fogState, depth, selected, fogEnabled);

      ctx.save();
      drawOrganicPath(points);
      ctx.fillStyle = fogStyle.fill;
      ctx.strokeStyle = fogStyle.stroke;
      ctx.lineWidth = fogStyle.lineWidth;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawFiles(): void {
    const fogEnabled = deps.isDiscoveryEnabled();
    const view = deps.getView();
    const activityFog = deps.getActivityFog();
    const selectedTarget = deps.getSelectedTarget();
    let renderedSourceLines = 0;
    for (const file of deps.getMapFiles()) {
      if (!file.bounds) {
        continue;
      }
      const box = screenBounds(file.bounds);
      if (!visible(box)) {
        continue;
      }
      const selected = selectedTarget?.targetType === "file" && selectedTarget.path === file.path;
      const fogState = fogEnabled ? fogStateForFile(activityFog, file, { selected }) : "visible";
      const visualState = fileVisualState({ file, box, scale: view.scale, selected });
      if (visualState === "hidden") {
        continue;
      }

      const style = fileFogStyle(
        { fogState, selected, visualState, discoveryMode: fogEnabled },
        view.scale,
      );
      ctx.fillStyle = style.fill;
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = style.lineWidth;
      deps.drawRect(box);
      if (shouldLabelFoggedFile({ file, box, scale: view.scale, selected, fogState })) {
        deps.queueLabelInBox({
          text: file.name ?? file.path,
          box,
          color: style.label,
          size: 12,
          weight: "500",
          priority: fileLabelPriority({ file, selected }),
        });
      }
      if (
        shouldShowFogSourceText(fogState, { selected }) &&
        canRenderSourceText(file, box) &&
        renderedSourceLines < SOURCE_TEXT_MAX_LINES_PER_FRAME
      ) {
        renderedSourceLines += drawSourceText(
          file,
          box,
          SOURCE_TEXT_MAX_LINES_PER_FRAME - renderedSourceLines,
        );
      } else if (
        shouldShowFogSourceText(fogState, { selected }) &&
        view.scale > 6 &&
        box.height > 34
      ) {
        drawLineBands(file, box);
      }
    }
  }

  function drawOrganicPath(points: Point[]): void {
    const firstPoint = points[0];
    const secondPoint = points[1];
    if (!firstPoint || !secondPoint) {
      return;
    }
    const first = worldToScreen(firstPoint);
    const second = worldToScreen(secondPoint);
    ctx.beginPath();
    ctx.moveTo((first.x + second.x) / 2, (first.y + second.y) / 2);

    for (let index = 1; index <= points.length; index += 1) {
      const controlPoint = points[index % points.length];
      const nextPoint = points[(index + 1) % points.length];
      if (!controlPoint || !nextPoint) {
        continue;
      }
      const control = worldToScreen(controlPoint);
      const next = worldToScreen(nextPoint);
      ctx.quadraticCurveTo(
        control.x,
        control.y,
        (control.x + next.x) / 2,
        (control.y + next.y) / 2,
      );
    }

    ctx.closePath();
  }

  function drawSourceText(file: MapFile, box: Bounds, remainingBudget: number): number {
    const visibleRange = visibleLineRange(file, box);
    const lineCount = file.lineCount ?? 0;
    if (!visibleRange) {
      return 0;
    }
    const clipBox = screenIntersection(box);
    if (!clipBox) {
      return 0;
    }

    const budgetedEnd = Math.min(visibleRange.end, visibleRange.start + remainingBudget - 1);
    const fetchStart = Math.max(1, visibleRange.start - SOURCE_TEXT_PREFETCH_LINES);
    const fetchEnd = Math.min(lineCount, budgetedEnd + SOURCE_TEXT_PREFETCH_LINES);
    const cacheKey = sourceRangeCacheKey(file.path, fetchStart, fetchEnd);
    const cached = cachedSourceRange(deps.getSourceCache(), file.path, fetchStart, fetchEnd);

    if (!cached) {
      requestSourceRange(file.path, fetchStart, fetchEnd, cacheKey);
      drawSourcePlaceholder(box);
      return 0;
    }

    const linesByNumber = sourceLinesByNumber(cached);
    const lineHeight = lineHeightForFile(file, box);
    const firstBaseline =
      box.y + (visibleRange.start - 1) * lineHeight + Math.min(13, lineHeight * 0.78);
    const sourceTextLayout = sourceTextLayoutForBox(box, deps.canvasSize().width);
    let drawn = 0;

    ctx.save();
    ctx.beginPath();
    ctx.rect(clipBox.x, clipBox.y, clipBox.width, clipBox.height);
    ctx.clip();
    ctx.font = "12px SFMono-Regular, Consolas, Liberation Mono, monospace";
    ctx.textBaseline = "alphabetic";

    for (let lineNumber = visibleRange.start; lineNumber <= budgetedEnd; lineNumber += 1) {
      const y = firstBaseline + drawn * lineHeight;
      if (y > box.y + box.height) {
        break;
      }
      const text = linesByNumber.get(lineNumber) ?? "";
      ctx.fillStyle = "rgba(63, 83, 97, 0.58)";
      ctx.fillText(String(lineNumber).padStart(4, " "), sourceTextLayout.lineNumberX, y);
      ctx.fillStyle = "rgba(12, 34, 48, 0.86)";
      ctx.fillText(truncateLine(text, sourceTextLayout.maxChars), sourceTextLayout.textX, y);
      drawn += 1;
    }

    ctx.restore();
    return drawn;
  }

  function sourceLinesByNumber(source: SourceRange): Map<number | string, string> {
    const cached = sourceLinesByNumberCache.get(source);
    if (cached) {
      return cached;
    }
    const linesByNumber = new Map<number | string, string>();
    for (const line of source.lines ?? []) {
      linesByNumber.set(line.number, line.text);
    }
    sourceLinesByNumberCache.set(source, linesByNumber);
    return linesByNumber;
  }

  function drawSourcePlaceholder(box: Bounds): void {
    ctx.save();
    ctx.fillStyle = "rgba(255, 255, 255, 0.36)";
    ctx.fillRect(
      box.x + 4,
      box.y + 4,
      Math.max(0, box.width - 8),
      Math.min(24, Math.max(0, box.height - 8)),
    );
    ctx.restore();
  }

  function visibleLineRange(file: MapFile, box: Bounds) {
    return visibleLineRangeForBox(file, box, deps.canvasSize().height);
  }

  function requestSourceRange(
    path: string,
    lineStart: number,
    lineEnd: number,
    cacheKey: string,
  ): void {
    const pendingSourceRequests = deps.getPendingSourceRequests();
    if (pendingSourceRequests.has(cacheKey)) {
      return;
    }
    pendingSourceRequests.add(cacheKey);
    deps
      .fetchJson<SourceRange>(
        sourceContextRequest(path, { start: lineStart, end: lineEnd }).sourceUrl,
      )
      .then((source) => {
        rememberSourceRange(deps.getSourceCache(), cacheKey, source);
        deps.render();
      })
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        pendingSourceRequests.delete(cacheKey);
      });
  }

  function drawLineBands(file: MapFile, box: Bounds): void {
    const lines = Math.min(file.lineCount ?? 0, 80);
    const clipBox = screenIntersection(box);
    if (!clipBox) {
      return;
    }
    ctx.strokeStyle = "rgba(4, 120, 87, 0.18)";
    ctx.lineWidth = 1;
    for (let i = 1; i < lines; i += 1) {
      const y = box.y + (box.height * i) / lines;
      if (y < clipBox.y || y > clipBox.y + clipBox.height) {
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(clipBox.x, y);
      ctx.lineTo(clipBox.x + clipBox.width, y);
      ctx.stroke();
    }
  }

  function drawNamedPlaces(): void {
    const selectedTarget = deps.getSelectedTarget();
    const annotations: MapAnnotationPlace[] = [];
    for (const place of deps.getNamedPlaces()) {
      if (place.kind === "mapAnnotation") {
        annotations.push(place);
        continue;
      }
      if (place.kind !== "drawnSelection") {
        continue;
      }
      if (!hasGeometryBounds(place)) {
        continue;
      }
      deps.drawSelection(place.geometry.bounds, "rgba(245, 158, 11, 0.08)", "#f59e0b", []);
      const box = screenBounds(place.geometry.bounds);
      deps.drawLabel(place.name ?? "", box.x + 6, box.y + 16, "#92400e");
    }

    annotations.forEach((annotation, index) => {
      const selected =
        selectedTarget?.targetType === "annotation" && selectedTarget.id === annotation.id;
      drawAnnotation(annotation, index + 1, selected);
    });
  }

  function drawAnnotation(
    annotation: MapAnnotationPlace,
    markerNumber: number,
    selected: boolean,
  ): void {
    if (!hasGeometryBounds(annotation)) {
      return;
    }
    drawAnnotationMembrane(
      annotation.geometry.bounds,
      selected ? "rgba(37, 99, 235, 0.13)" : "rgba(37, 99, 235, 0.07)",
      selected ? "#1d4ed8" : "rgba(37, 99, 235, 0.8)",
      selected,
      annotation.id ?? annotation.name ?? "annotation",
    );

    const box = screenBounds(annotation.geometry.bounds);
    if (box.width > 68 && box.height > 22) {
      deps.drawLabel(annotation.name ?? "Annotation", box.x + 8, box.y + 18, "#1e3a8a", 12, "700");
    }
    drawAnnotationMarker(annotation, markerNumber, selected);
  }

  function drawAnnotationMembrane(
    bounds: Bounds,
    fill: string,
    stroke: string,
    selected: boolean,
    key: string,
  ): void {
    const points = cachedOrganicRegionPoints(bounds, `annotation:${key}`, 0);
    if (points.length < 3) {
      return;
    }

    ctx.save();
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = selected ? 2.5 : 1.6;
    if (!selected) {
      ctx.setLineDash([6, 5]);
    }
    drawOrganicPath(points);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function cachedOrganicRegionPoints(bounds: Bounds, key: string, depth: number): Point[] {
    const cacheKey = `${key}:${depth}:${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}`;
    const cached = organicRegionPointsCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const points = organicRegionPoints(bounds, key, depth);
    organicRegionPointsCache.set(cacheKey, points);
    return points;
  }

  function drawAnnotationMarker(
    annotation: MapAnnotationPlace,
    markerNumber: number,
    selected: boolean,
  ): void {
    if (!hasGeometryBounds(annotation)) {
      return;
    }
    const center = worldToScreen(boundsCenter(annotation.geometry.bounds));
    const radius = selected ? 13 : 11;
    ctx.save();
    ctx.fillStyle = selected ? "#1d4ed8" : "#2563eb";
    ctx.strokeStyle = "#eff6ff";
    ctx.lineWidth = selected ? 3 : 2.4;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "700 11px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(markerNumber), center.x, center.y + 0.5);
    ctx.restore();
  }

  return {
    clearCaches,
    drawGrid,
    drawCompassRose,
    drawFolders,
    drawOrganicRegions,
    drawFiles,
    drawNamedPlaces,
  };
}
