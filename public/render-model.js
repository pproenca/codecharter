export const SOURCE_TEXT_MIN_LINE_HEIGHT = 14;
export const SOURCE_TEXT_MIN_WIDTH = 260;
export const SOURCE_TEXT_MAX_LINES_PER_FRAME = 200;
export const SOURCE_TEXT_PREFETCH_LINES = 12;
export const SOURCE_CACHE_LIMIT = 80;
export const SOURCE_TEXT_ZOOM_HEADROOM = 1.08;
export const SOURCE_PANEL_CONTEXT_BEFORE = 12;
export const SOURCE_PANEL_CONTEXT_AFTER = 24;
export const SOURCE_PANEL_MAX_LINES = 140;
export const MAP_MIN_SCALE = 0.65;
export const MAP_MAX_SCALE = 160;
export const ORGANIC_REGION_EDGE_POSITIONS = [0.08, 0.24, 0.42, 0.6, 0.78, 0.92];
export const KEYBOARD_PAN_PIXELS = 72;
export const KEYBOARD_ZOOM_FACTOR = 1.25;
export const ACTIVITY_DORMANT_AFTER_MINUTES = 30;
export const ACTIVITY_DECAY_HALF_LIFE_MINUTES = 90;
export const ACTIVITY_LIVE_WINDOW_MINUTES = 360;
export const ACTIVITY_MIN_ALPHA = 0.18;
export const ACTIVITY_TRAIL_MIN_SEGMENT_PX = 8;
export const ACTIVITY_TRAIL_MAX_SEGMENT_PX = 220;
export const ACTIVITY_TRAIL_TENSION = 0.72;
export const ACTIVITY_TRAIL_MAX_GAP_MINUTES = 20;

export const DISTRICT_PALETTE = [
  { fill: [126, 176, 156], stroke: [41, 98, 73], label: "#24513d" },
  { fill: [111, 162, 190], stroke: [39, 92, 122], label: "#244e66" },
  { fill: [188, 154, 92], stroke: [126, 89, 34], label: "#6f4f1f" },
  { fill: [176, 128, 137], stroke: [118, 65, 77], label: "#6f3d49" },
  { fill: [126, 151, 117], stroke: [68, 101, 55], label: "#3f5d34" },
];

const LANDMARK_NAMES = new Set([
  "AGENTS.md",
  "CONTEXT.md",
  "README.md",
  "package.json",
  "app.js",
  "index.html",
  "server.js",
]);

const ACTIVITY_STATE_STYLES = {
  reading: { fill: "#2563eb", stroke: "#dbeafe", label: "#1e3a8a" },
  editing: { fill: "#e11d48", stroke: "#ffe4e6", label: "#9f1239" },
  testing: { fill: "#7c3aed", stroke: "#ede9fe", label: "#4c1d95" },
  reviewing: { fill: "#f59e0b", stroke: "#fef3c7", label: "#92400e" },
};

export function detailBand(scale) {
  if (scale < 1.35) return "district";
  if (scale < 2.4) return "neighborhood";
  if (scale < 4.5) return "block";
  if (scale < 10) return "parcel";
  return "source";
}

export function maxFolderDepthForScale(scale) {
  const band = detailBand(scale);
  if (band === "district") return 1;
  if (band === "neighborhood") return 2;
  if (band === "block") return 3;
  return 99;
}

export function folderDepth(path) {
  return path ? path.split("/").length : 0;
}

export function folderStyle(path, depth) {
  const base = DISTRICT_PALETTE[hashString(path.split("/")[0]) % DISTRICT_PALETTE.length];
  const fillAlpha = depth === 1 ? 0.18 : 0.09;
  const strokeAlpha = depth === 1 ? 0.52 : 0.28;
  return {
    fill: rgba(base.fill, fillAlpha),
    stroke: rgba(base.stroke, strokeAlpha),
    label: base.label,
  };
}

export function organicRegionStyle(path, depth) {
  const base = DISTRICT_PALETTE[hashString(path.split("/")[0]) % DISTRICT_PALETTE.length];
  const fillAlpha = depth === 1 ? 0.1 : 0.055;
  const strokeAlpha = depth === 1 ? 0.5 : 0.32;
  return {
    fill: rgba(base.fill, fillAlpha),
    stroke: rgba(base.stroke, strokeAlpha),
  };
}

export function shouldDrawOrganicRegion(scale, depth, box) {
  if (depth > 4) return false;
  if (depth > maxFolderDepthForScale(scale) + 1) return false;
  if (Math.min(box.width, box.height) < 68) return false;
  return box.width * box.height >= 7200;
}

export function organicRegionPoints(bounds, key, depth = 1) {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return [];
  const edgePositions = ORGANIC_REGION_EDGE_POSITIONS;
  const minInset = 0.018;
  const baseInset = clamp(0.024 + depth * 0.004, minInset, 0.058);
  const wobble = clamp(0.018 - depth * 0.002, 0.006, 0.018);
  const points = [];

  for (let index = 0; index < edgePositions.length; index += 1) {
    const t = edgePositions[index];
    points.push({
      x: bounds.x + bounds.width * t,
      y: bounds.y + bounds.height * edgeInset(key, "top", index, baseInset, wobble),
    });
  }
  for (let index = 0; index < edgePositions.length; index += 1) {
    const t = edgePositions[index];
    points.push({
      x: bounds.x + bounds.width * (1 - edgeInset(key, "right", index, baseInset, wobble)),
      y: bounds.y + bounds.height * t,
    });
  }
  for (let index = edgePositions.length - 1; index >= 0; index -= 1) {
    const t = edgePositions[index];
    points.push({
      x: bounds.x + bounds.width * t,
      y: bounds.y + bounds.height * (1 - edgeInset(key, "bottom", index, baseInset, wobble)),
    });
  }
  for (let index = edgePositions.length - 1; index >= 0; index -= 1) {
    const t = edgePositions[index];
    points.push({
      x: bounds.x + bounds.width * edgeInset(key, "left", index, baseInset, wobble),
      y: bounds.y + bounds.height * t,
    });
  }

  return points;
}

export function shouldDrawFolder(scale, depth, box) {
  const minDimension = Math.min(box.width, box.height);
  if (minDimension < (depth <= 1 ? 6 : 10)) return false;
  if (depth <= maxFolderDepthForScale(scale)) return true;
  return depth <= 3 && box.width > 360 && box.height > 220;
}

export function shouldLabelFolder(scale, depth, box) {
  if (box.width <= 90 || box.height <= 28) return false;
  return depth <= maxFolderDepthForScale(scale) || (box.width > 260 && box.height > 120);
}

export function folderLabelPriority(depth, box) {
  return 80 - depth * 6 + Math.min(16, Math.log2(Math.max(1, box.width * box.height)));
}

export function landmarkScore(file) {
  let score = 0;
  if (LANDMARK_NAMES.has(file.name)) score += 24;
  if (file.path.startsWith("src/")) score += 8;
  if (file.path.startsWith("public/")) score += 6;
  if (file.path.includes("test")) score += 4;
  if (file.name.endsWith(".test.js")) score += 5;
  return score;
}

export function fileVisualState({ file, box, scale, selected }) {
  const landmark = landmarkScore(file) > 0 && box.width > 76 && box.height > 26;
  const readable = canRenderSourceText(file, box);
  const area = box.width * box.height;
  const shapedParcel = box.width >= 12 && box.height >= 10 && area >= 240;
  const clearParcel = box.width >= 42 && box.height >= 16 && area >= 780;
  const visibleParcel = selected
    || readable
    || landmark
    || clearParcel
    || (scale > 2.2 && shapedParcel);

  if (!visibleParcel) return "hidden";
  if (readable) return "source";
  if (selected) return "selected";
  if (landmark) return "landmark";
  if (!clearParcel) return "aggregate";
  return "parcel";
}

export function shouldLabelFile({ file, box, scale, selected }) {
  if (canRenderSourceText(file, box)) return false;
  if (selected) return true;
  if (landmarkScore(file) > 0 && box.width > 76 && box.height > 26) return true;
  return scale > 2.2 && box.width > 78 && box.height > 24;
}

export function fileLabelPriority({ file, selected }) {
  return (selected ? 120 : 40) + landmarkScore(file);
}

export function canRenderSourceText(file, box) {
  return box.width >= SOURCE_TEXT_MIN_WIDTH
    && lineHeightForFile(file, box) >= SOURCE_TEXT_MIN_LINE_HEIGHT
    && file.lineCount > 0;
}

export function lineHeightForFile(file, box) {
  return box.height / Math.max(1, file.lineCount);
}

export function labelBoxesOverlap(a, b) {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y;
}

export function worldToScreenPoint(point, view, viewport) {
  return {
    x: (point.x - view.x) * viewport.width * view.scale,
    y: (point.y - view.y) * viewport.height * view.scale,
  };
}

export function screenToWorldPoint(point, view, viewport) {
  return {
    x: point.x / (viewport.width * view.scale) + view.x,
    y: point.y / (viewport.height * view.scale) + view.y,
  };
}

export function screenBoundsForView(bounds, view, viewport) {
  const point = worldToScreenPoint({ x: bounds.x, y: bounds.y }, view, viewport);
  return {
    x: point.x,
    y: point.y,
    width: bounds.width * viewport.width * view.scale,
    height: bounds.height * viewport.height * view.scale,
  };
}

export function isScreenBoxVisible(box, viewport) {
  return box.x + box.width >= 0
    && box.y + box.height >= 0
    && box.x <= viewport.width
    && box.y <= viewport.height;
}

export function zoomViewAt(view, screenAnchor, factor, viewport, minScale = MAP_MIN_SCALE, maxScale = MAP_MAX_SCALE) {
  const before = screenToWorldPoint(screenAnchor, view, viewport);
  const scale = clamp(view.scale * factor, minScale, maxScale);
  const after = screenToWorldPoint(screenAnchor, { ...view, scale }, viewport);
  return {
    x: view.x + before.x - after.x,
    y: view.y + before.y - after.y,
    scale,
  };
}

export function panViewByScreenDelta(view, delta, viewport) {
  return {
    ...view,
    x: view.x + delta.x / (viewport.width * view.scale),
    y: view.y + delta.y / (viewport.height * view.scale),
  };
}

export function panViewForDrag(drag, screen, viewport) {
  return panViewByScreenDelta(drag.view, {
    x: drag.start.x - screen.x,
    y: drag.start.y - screen.y,
  }, viewport);
}

export function canvasKeyboardAction(event) {
  const keyDeltas = {
    ArrowRight: { x: KEYBOARD_PAN_PIXELS, y: 0 },
    ArrowLeft: { x: -KEYBOARD_PAN_PIXELS, y: 0 },
    ArrowDown: { x: 0, y: KEYBOARD_PAN_PIXELS },
    ArrowUp: { x: 0, y: -KEYBOARD_PAN_PIXELS },
  };
  const delta = keyDeltas[event.key];
  if (delta) return { type: "pan", delta };
  if (event.key === "+" || event.key === "=") return { type: "zoomIn" };
  if (event.key === "-" || event.key === "_") return { type: "zoomOut" };
  if (event.key === "0") return { type: "fitCodebase" };
  if (event.key === "Enter") return { type: "selectCenter" };
  return null;
}

export function documentKeyboardAction(event, context = {}) {
  const commandModifier = event.metaKey || event.ctrlKey;
  const textEntry = Boolean(context.textEntry);
  const hasSelectedAnnotation = Boolean(context.hasSelectedAnnotation);
  const hasResolvedSelection = Boolean(context.hasResolvedSelection);

  if (!textEntry && !context.buttonTarget && isSpaceKeyEvent(event) && !event.repeat) return { type: "startSpacePan" };
  if (event.key === "Escape") return { type: "cancelInteraction" };
  if (commandModifier && event.key === "Enter" && (hasResolvedSelection || hasSelectedAnnotation)) return { type: "saveSelection" };
  if (!textEntry && commandModifier && event.key?.toLowerCase() === "c" && hasSelectedAnnotation) return { type: "copyAnnotationPrompt" };
  if (!textEntry && (event.key === "Delete" || event.key === "Backspace") && hasSelectedAnnotation) return { type: "deleteAnnotation" };
  return null;
}

export function doubleClickMapAction(hit) {
  if (!hit) return null;
  if (hit.targetType === "annotation") return { type: "focusAnnotation" };
  if (hit.targetType === "folder") return { type: "selectFolder" };
  if (hit.targetType === "file") return { type: "selectFile" };
  if (hit.targetType === "activity") return { type: "selectActivity" };
  return null;
}

export function mapTargetSelectionAction(hit) {
  if (!hit) return { type: "clearSelection" };
  if (hit.targetType === "annotation") return { type: "focusAnnotation" };
  if (hit.targetType === "activity") return { type: "selectActivity" };
  if (hit.targetType === "folder") return { type: "inspectFolder" };
  if (hit.targetType === "file") return { type: "inspectFile" };
  return { type: "clearSelection" };
}

export function isSpaceKeyEvent(event) {
  return event.code === "Space" || event.key === " " || event.key === "Spacebar";
}

export function viewForBounds(bounds, viewport, paddingFactor = 1.2, minScale = MAP_MIN_SCALE, maxScale = MAP_MAX_SCALE) {
  const scaleX = 1 / Math.max(bounds.width * paddingFactor, 0.001);
  const scaleY = 1 / Math.max(bounds.height * paddingFactor, 0.001);
  const scale = clamp(Math.min(scaleX, scaleY), minScale, maxScale);
  return {
    scale,
    x: bounds.x + bounds.width / 2 - 0.5 / scale,
    y: bounds.y + bounds.height / 2 - 0.5 / scale,
  };
}

export function viewForReadableFile(file, viewport, lineRatio = 0.5, minScale = MAP_MIN_SCALE, maxScale = MAP_MAX_SCALE) {
  const widthScale = SOURCE_TEXT_MIN_WIDTH / Math.max(file.bounds.width * viewport.width, 0.001);
  const lineScale = (SOURCE_TEXT_MIN_LINE_HEIGHT * Math.max(1, file.lineCount)) / Math.max(file.bounds.height * viewport.height, 0.001);
  const scale = clamp(Math.max(widthScale, lineScale) * SOURCE_TEXT_ZOOM_HEADROOM, minScale, maxScale);
  const screenWidth = file.bounds.width * viewport.width * scale;
  const focusX = file.bounds.x + file.bounds.width / 2;
  const focusY = file.bounds.y + file.bounds.height * clamp(lineRatio, 0, 1);
  return {
    scale,
    x: screenWidth > viewport.width * 0.9
      ? file.bounds.x - 24 / (viewport.width * scale)
      : focusX - 0.5 / scale,
    y: focusY - 0.5 / scale,
  };
}

export function visibleLineRangeForBox(file, box, viewportHeight) {
  const top = Math.max(box.y, 0);
  const bottom = Math.min(box.y + box.height, viewportHeight);
  if (bottom <= top) return null;

  const startRatio = clamp((top - box.y) / box.height, 0, 1);
  const endRatio = clamp((bottom - box.y) / box.height, 0, 1);
  return {
    start: Math.max(1, Math.floor(startRatio * file.lineCount) + 1),
    end: Math.min(file.lineCount, Math.ceil(endRatio * file.lineCount)),
  };
}

export function lineAtWorldPoint(file, worldPoint) {
  const rawLine = ((worldPoint.y - file.bounds.y) / file.bounds.height) * file.lineCount;
  return Math.max(1, Math.min(file.lineCount, Math.floor(rawLine) + 1));
}

export function sourcePanelLineRangeForBox(file, focusLine, box, viewportHeight) {
  const visibleRange = canRenderSourceText(file, box) ? visibleLineRangeForBox(file, box, viewportHeight) : null;
  if (visibleRange) return capLineRange(file, visibleRange.start, visibleRange.end, focusLine);
  return capLineRange(
    file,
    Math.max(1, focusLine - SOURCE_PANEL_CONTEXT_BEFORE),
    Math.min(file.lineCount, focusLine + SOURCE_PANEL_CONTEXT_AFTER),
    focusLine,
  );
}

export function interactionModeUiState({ drawing = false, panning = false, spacePanning = false, dragging = null } = {}) {
  const draggingPan = dragging?.type === "pan";
  return {
    selectActive: !drawing && !panning && !spacePanning && !draggingPan,
    panActive: panning || spacePanning || draggingPan,
    drawActive: drawing,
    panningMode: panning && !spacePanning && !draggingPan,
    drawingMode: drawing && !spacePanning,
    spacePanningMode: spacePanning,
    panning: draggingPan,
  };
}

export function draftSelectionFromDrag(start, current) {
  return {
    type: "rect",
    bounds: {
      x: start.x,
      y: start.y,
      width: current.x - start.x,
      height: current.y - start.y,
    },
  };
}

export function isUsableDraftSelection(selection, { viewport, scale, minPixels = 4 }) {
  if (!selection) return false;
  const bounds = selection.bounds;
  const width = Math.abs(bounds.width) * viewport.width * scale;
  const height = Math.abs(bounds.height) * viewport.height * scale;
  return width >= minPixels && height >= minPixels;
}

export function sourceContextRequest(path, lineRange = {}) {
  const lineStart = lineRange.start ?? 1;
  const lineEnd = lineRange.end ?? lineStart;
  const query = new URLSearchParams({
    path,
    lineStart: String(lineStart),
    lineEnd: String(lineEnd),
  }).toString();
  return {
    query,
    resolveUrl: `/api/resolve?${query}`,
    sourceUrl: `/api/source?${query}`,
    lines: `${lineStart}-${lineEnd}`,
  };
}

export function formatSourceLines(source) {
  return (source.lines ?? [])
    .map((item) => `${String(item.number).padStart(4, " ")}  ${item.text}`)
    .join("\n");
}

export function sourcePanelState({ path = "", deepLink = "", source = null, fallbackOutput = "" } = {}) {
  if (source) {
    return {
      sourceTitle: [path, deepLink].filter(Boolean).join(" · "),
      sourceOutput: formatSourceLines(source),
      scrollTop: 0,
    };
  }

  return {
    sourceTitle: path || deepLink,
    sourceOutput: fallbackOutput,
  };
}

export function annotationClipboardText(annotation, { origin = "", href = "" } = {}) {
  const reference = annotation.deepLink || `codecharter://annotation/${annotation.id}`;
  const serverFlag = origin ? ` --server ${doubleQuote(origin)}` : "";
  const comment = annotation.comment?.trim() || "<empty>";
  const prompt = [
    `CodeCharter annotation: ${reference}`,
    `Targets: ${annotation.resolvedTargets?.length ?? annotation.targetCount ?? 0}`,
    `Note: ${comment}`,
    `CLI: codecharter --json resolve ${doubleQuote(reference)}${serverFlag}`,
    `Fallback: npx --yes codecharter --json resolve ${doubleQuote(reference)}${serverFlag}`,
    "Use resolve output; read only needed resolvedTargets. If resolved target paths are not present in this workspace, report a CodeCharter map/workspace mismatch instead of guessing. Do not use browser automation unless asked.",
  ].join("\n");
  const shareUrl = annotationShareUrl(annotation, href);
  if (!shareUrl) return prompt;
  return [
    prompt,
    "",
    `CodeCharter URL: ${shareUrl}`,
  ].join("\n");
}

function annotationShareUrl(annotation, href) {
  if (!href || !annotation.browserHash) return "";
  const url = new URL(href);
  url.hash = annotation.browserHash;
  return url.toString();
}

function doubleQuote(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function sourceRangeCacheKey(path, lineStart, lineEnd) {
  return `${normalizeMapPath(path)}:${lineStart}-${lineEnd}`;
}

export function rememberSourceRange(cache, cacheKey, source, limit = SOURCE_CACHE_LIMIT) {
  if (cache.has(cacheKey)) cache.delete(cacheKey);
  cache.set(cacheKey, source);
  while (cache.size > limit) {
    cache.delete(cache.keys().next().value);
  }
}

export function cachedSourceRange(cache, path, lineStart, lineEnd) {
  const normalized = normalizeMapPath(path);
  for (const [cacheKey, source] of cache) {
    if (normalizeMapPath(source.path) !== normalized) continue;
    if (source.lineRange.start > lineStart || source.lineRange.end < lineEnd) continue;
    cache.delete(cacheKey);
    cache.set(cacheKey, source);
    return source;
  }
  return null;
}

export function normalizeMapPath(path) {
  const normalized = String(path ?? "").replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
  return normalized === "." ? "" : normalized;
}

export function mapRouteTarget(codemap, route) {
  const path = route.params?.get("path");
  if (path) return mapTargetForPath(codemap, path);
  return mapTargetForGeohash(codemap, route.locator, route.kind);
}

export function hashRouteFocusIntent(route, { hasMap = true } = {}) {
  if (!route || !hasMap) return null;
  if (route.type === "annotation") return { type: "annotation", id: route.id };
  if (route.type === "selection") return { type: "selection", params: route.params };
  if (route.type === "map") return { type: "map", route };
  return null;
}

export function mapSearchMatch(codemap, namedPlaces, query) {
  const normalized = String(query ?? "").trim().toLowerCase();
  if (!normalized) return null;

  const namedPlace = namedPlaces.find((place) => place.name?.toLowerCase().includes(normalized));
  if (namedPlace?.geometry?.bounds) {
    const annotation = namedPlace.kind === "mapAnnotation";
    return {
      type: annotation ? "annotation" : "namedPlace",
      label: `${annotation ? "Annotation" : "Named place"}: ${namedPlace.name}`,
      place: namedPlace,
      target: annotation ? { ...namedPlace, targetType: "annotation" } : null,
    };
  }

  const file = Object.values(codemap.files).find((candidate) =>
    candidate.path.toLowerCase().includes(normalized) || candidate.geo.geohash.startsWith(normalized)
  );
  if (file) return { type: "file", label: `File: ${file.path}`, file };

  const folder = Object.values(codemap.folders).find((candidate) =>
    candidate.path.toLowerCase().includes(normalized) || candidate.geo.geohash.startsWith(normalized)
  );
  if (folder) return { type: "folder", label: `Folder: ${folder.path || "."}`, folder };

  return null;
}

export function mapSearchAction(match) {
  if (!match) return { type: "noMatch" };
  if (match.type === "annotation" || match.type === "namedPlace") return { type: "focusPlace" };
  if (match.type === "file") return { type: "focusFile" };
  if (match.type === "folder") return { type: "focusFolder" };
  return { type: "noMatch" };
}

export function mapSelectionPanel(target) {
  if (!target) {
    return {
      inspectorTitle: "No place selected",
      inspectorSubtitle: "Click a district, parcel, or activity marker.",
      sourceTitle: "No file selected",
      sourceOutput: "",
    };
  }

  const inspectorTitle = target.targetType === "file" ? target.name : folderDisplayName(target);
  const inspectorSubtitle = `${target.targetType}: ${target.path || "."} | ${target.geo.geohash}`;
  if (target.targetType === "folder") {
    return {
      inspectorTitle,
      inspectorSubtitle,
      sourceTitle: target.path || ".",
      sourceOutput: "Folder selected.",
    };
  }

  return {
    inspectorTitle,
    inspectorSubtitle,
  };
}

export function folderDisplayName(folder) {
  if (!folder.path) return "Codebase";
  return folder.path.split("/").at(-1);
}

function mapTargetForPath(codemap, path) {
  const normalized = normalizeMapPath(path);
  if (codemap.files[normalized]) return { ...codemap.files[normalized], targetType: "file" };
  if (codemap.folders[normalized]) return { ...codemap.folders[normalized], targetType: "folder" };
  return null;
}

function mapTargetForGeohash(codemap, geohash, kind) {
  const candidates = kind === "folder"
    ? Object.values(codemap.folders).filter((folder) => folder.path)
    : Object.values(codemap.files);
  const target = candidates.find((candidate) => candidate.geo.geohash.startsWith(geohash))
    ?? candidates.find((candidate) => geohash.startsWith(candidate.geo.geohash));
  return target ? { ...target, targetType: kind === "folder" ? "folder" : "file" } : null;
}

export function boundsCenter(bounds) {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

export function containsBoundsPoint(bounds, point) {
  return point.x >= bounds.x
    && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y
    && point.y <= bounds.y + bounds.height;
}

export function hitTestTargets(codemap, point) {
  const files = Object.values(codemap.files)
    .filter((file) => containsBoundsPoint(file.bounds, point))
    .sort(compareTargetAreaThenPath);
  if (files.length > 0) return { ...files[0], targetType: "file" };

  const folders = Object.values(codemap.folders)
    .filter((folder) => folder.path && containsBoundsPoint(folder.bounds, point))
    .sort(compareTargetAreaThenPath);
  if (folders.length > 0) return { ...folders[0], targetType: "folder" };

  return null;
}

export function rgba(rgb, alpha) {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

export function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function activityStateStyle(activityState) {
  return ACTIVITY_STATE_STYLES[normalizeActivityState(activityState)];
}

export function normalizeActivityState(activityState) {
  if (activityState === "blocked") return "reviewing";
  return ACTIVITY_STATE_STYLES[activityState] ? activityState : "reading";
}

export function activityVisualEncoding(event, { latest = false, selected = false, now = Date.now() } = {}) {
  const activityState = normalizeActivityState(event?.activityState);
  const ageMinutes = activityAgeMinutes(event, now);
  const decay = 2 ** (-ageMinutes / ACTIVITY_DECAY_HALF_LIFE_MINUTES);
  const vitality = selected ? 1 : clamp(1 - ageMinutes / ACTIVITY_LIVE_WINDOW_MINUTES, 0, 1);
  const dormant = !selected && ageMinutes > ACTIVITY_DORMANT_AFTER_MINUTES;
  const dormancy = selected
    ? 0
    : clamp(
      (ageMinutes - ACTIVITY_DORMANT_AFTER_MINUTES)
        / (ACTIVITY_LIVE_WINDOW_MINUTES - ACTIVITY_DORMANT_AFTER_MINUTES),
      0,
      1,
    );
  const activeAlpha = selected
    ? 1
    : clamp(((latest ? 0.42 : ACTIVITY_MIN_ALPHA) + decay * (latest ? 0.58 : 0.38)) * vitality, 0, 1);
  const alpha = dormant ? activeAlpha * (0.38 - dormancy * 0.18) : activeAlpha;
  const activeScale = Math.max(0.55, vitality);
  const dormantScale = 0.42 + (1 - dormancy) * 0.22;
  const presenceScale = selected ? 1 : dormant ? dormantScale : activeScale;

  return {
    activityState,
    active: !dormant,
    dormant,
    selected,
    ageMinutes,
    alpha,
    coreRadius: (selected ? 8 : latest ? 6.5 : 3.8) * presenceScale,
    haloRadius: dormant ? (latest ? 8 : 5) * presenceScale : (selected ? 28 : latest ? 22 : 12) * presenceScale,
    membraneAlpha: dormant
      ? (selected ? 0.18 : latest ? 0.045 : 0.025) * vitality
      : (selected ? 0.22 : latest ? 0.15 : 0.07) * (selected ? 1 : vitality),
    trailAlpha: dormant
      ? (selected ? 0.36 : latest ? 0.09 : 0.045) * vitality
      : (selected ? 0.72 : latest ? 0.42 : 0.18) * (selected ? 1 : vitality),
    lineWidth: selected ? 3.2 : latest && !dormant ? 2.2 : latest ? 1.15 : 1.1,
  };
}

export function activityTissueBox(screenBox, encoding = {}) {
  const minWidth = encoding.selected ? 30 : 18;
  const minHeight = encoding.selected ? 18 : 10;
  const width = Math.max(screenBox.width, minWidth);
  const height = Math.max(screenBox.height, minHeight);
  return {
    x: screenBox.x + screenBox.width / 2 - width / 2,
    y: screenBox.y + screenBox.height / 2 - height / 2,
    width,
    height,
  };
}

export function activityFragmentBounds(event) {
  const fragments = event?.address?.fragments
    ?.map((fragment) => fragment.bounds)
    .filter(Boolean) ?? [];
  return fragments.length ? fragments : event?.address?.bounds ? [event.address.bounds] : [];
}

export function activityPrimaryBounds(event) {
  return activityFragmentBounds(event)[0] ?? event?.address?.bounds ?? null;
}

export function simplifyTrailPoints(points, minDistance = ACTIVITY_TRAIL_MIN_SEGMENT_PX) {
  if (points.length <= 2) return [...points];
  const simplified = [points[0]];

  for (let index = 1; index < points.length - 1; index += 1) {
    if (pointDistance(simplified[simplified.length - 1], points[index]) >= minDistance) {
      simplified.push(points[index]);
    }
  }

  const last = points[points.length - 1];
  if (pointDistance(simplified[simplified.length - 1], last) > 0) {
    simplified.push(last);
  }

  return simplified.length > 1 ? simplified : [points[0], last];
}

export function activityTrailGroups(events, {
  maxGapMinutes = ACTIVITY_TRAIL_MAX_GAP_MINUTES,
  now = Date.now(),
  maxAgeMinutes = ACTIVITY_LIVE_WINDOW_MINUTES,
} = {}) {
  const byTrail = new Map();
  for (const event of sortedActivityEvents(events, Number.POSITIVE_INFINITY, { now, maxAgeMinutes })) {
    if (!activityPrimaryBounds(event)) continue;
    const key = activityTrailKey(event);
    if (!byTrail.has(key)) byTrail.set(key, []);
    byTrail.get(key).push(event);
  }

  const groups = [];
  for (const trailEvents of byTrail.values()) {
    let current = [];
    for (const event of trailEvents) {
      if (shouldStartActivityTrailGroup(current.at(-1), event, maxGapMinutes)) {
        if (current.length > 1) groups.push(current);
        current = [];
      }
      current.push(event);
    }
    if (current.length > 1) groups.push(current);
  }

  return groups.sort(compareActivityGroupsByTime);
}

export function activityTrailPointGroups(points, {
  maxSegmentDistance = ACTIVITY_TRAIL_MAX_SEGMENT_PX,
} = {}) {
  const groups = [];
  let current = [];

  for (const point of points) {
    const previous = current.at(-1);
    if (previous && pointDistance(previous, point) > maxSegmentDistance) {
      if (current.length > 1) groups.push(current);
      current = [];
    }
    current.push(point);
  }

  if (current.length > 1) groups.push(current);
  return groups;
}

export function organicTrailSegments(points, {
  minDistance = ACTIVITY_TRAIL_MIN_SEGMENT_PX,
  tension = ACTIVITY_TRAIL_TENSION,
} = {}) {
  const trail = simplifyTrailPoints(points, minDistance);
  if (trail.length < 2) return [];

  const segments = [];
  for (let index = 0; index < trail.length - 1; index += 1) {
    const previous = trail[index - 1] ?? trail[index];
    const start = trail[index];
    const end = trail[index + 1];
    const next = trail[index + 2] ?? end;
    const scalar = tension / 6;
    const segmentDistance = pointDistance(start, end);
    segments.push({
      start,
      control1: boundedTrailControlPoint({
        point: {
          x: start.x + (end.x - previous.x) * scalar,
          y: start.y + (end.y - previous.y) * scalar,
        },
        start,
        end,
        segmentDistance,
      }),
      control2: boundedTrailControlPoint({
        point: {
          x: end.x - (next.x - start.x) * scalar,
          y: end.y - (next.y - start.y) * scalar,
        },
        start,
        end,
        segmentDistance,
      }),
      end,
    });
  }
  return segments;
}

export function isLiveActivityEvent(event, { now = Date.now(), maxAgeMinutes = ACTIVITY_LIVE_WINDOW_MINUTES } = {}) {
  return activityPrimaryBounds(event) && activityAgeMinutes(event, now) <= maxAgeMinutes;
}

export function sortedActivityEvents(events, limit = 80, options = {}) {
  return [...events]
    .filter((event) => isLiveActivityEvent(event, options))
    .sort((a, b) => Date.parse(a.timestamp ?? 0) - Date.parse(b.timestamp ?? 0))
    .slice(-limit);
}

export function latestActivityByAgent(events, options = {}) {
  const latest = new Map();
  for (const event of sortedActivityEvents(events, Number.POSITIVE_INFINITY, options)) {
    latest.set(activityActorKey(event), event);
  }
  return latest;
}

export function activityActorKey(event) {
  return `${event?.agentId ?? "agent"}:${event?.threadId ?? event?.sessionId ?? "manual"}`;
}

function activityAgeMinutes(event, now) {
  const timestamp = Date.parse(event?.timestamp ?? "");
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, (now - timestamp) / 60000);
}

function activityTrailKey(event) {
  return activityActorKey(event);
}

function shouldStartActivityTrailGroup(previous, event, maxGapMinutes) {
  if (!previous) return false;
  const previousTime = Date.parse(previous.timestamp ?? "");
  const eventTime = Date.parse(event.timestamp ?? "");
  if (!Number.isFinite(previousTime) || !Number.isFinite(eventTime)) return false;
  return eventTime - previousTime > maxGapMinutes * 60000;
}

function compareActivityGroupsByTime(left, right) {
  const leftTime = Date.parse(left[0]?.timestamp ?? "");
  const rightTime = Date.parse(right[0]?.timestamp ?? "");
  return (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0);
}

function boundedTrailControlPoint({ point, start, end, segmentDistance }) {
  const padding = Math.min(18, Math.max(4, segmentDistance * 0.18));
  return {
    x: clamp(point.x, Math.min(start.x, end.x) - padding, Math.max(start.x, end.x) + padding),
    y: clamp(point.y, Math.min(start.y, end.y) - padding, Math.max(start.y, end.y) + padding),
  };
}

function edgeInset(key, edge, index, baseInset, wobble) {
  const unit = hashUnit(`${key}:${edge}:${index}`);
  return clamp(baseInset + (unit - 0.5) * wobble, 0.012, 0.08);
}

function capLineRange(file, start, end, focusLine) {
  if (end - start + 1 <= SOURCE_PANEL_MAX_LINES) return { start, end };
  const before = Math.floor(SOURCE_PANEL_MAX_LINES / 2);
  const cappedStart = Math.max(1, Math.min(focusLine - before, file.lineCount - SOURCE_PANEL_MAX_LINES + 1));
  return {
    start: cappedStart,
    end: Math.min(file.lineCount, cappedStart + SOURCE_PANEL_MAX_LINES - 1),
  };
}

function compareTargetAreaThenPath(a, b) {
  const areaDelta = a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height;
  if (Math.abs(areaDelta) > 1e-12) return areaDelta;
  return a.path.localeCompare(b.path);
}

function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function hashUnit(value) {
  return hashString(value) / 0xffffffff;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
