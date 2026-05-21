import {
  SOURCE_TEXT_MAX_LINES_PER_FRAME,
  SOURCE_TEXT_PREFETCH_LINES,
  activityFragmentBounds,
  activityPrimaryBounds,
  activityStateStyle,
  activityTrailGroups,
  activityTrailPointGroups,
  activityTissueBox,
  activityVisualEncoding,
  activityActorKey,
  activityActorLabel,
  annotationClipboardText,
  boundsCenter as modelBoundsCenter,
  cachedSourceRange,
  canvasKeyboardAction,
  canRenderSourceText,
  containsBoundsPoint,
  documentKeyboardAction,
  doubleClickMapAction,
  draftSelectionFromDrag,
  fileLabelPriority,
  fileVisualState,
  folderDepth,
  folderDisplayName,
  folderLabelPriority,
  folderStyle,
  hashString,
  hashRouteFocusIntent,
  hitTestTargets,
  interactionModeUiState,
  isSpaceKeyEvent,
  isUsableDraftSelection,
  isScreenBoxVisible,
  KEYBOARD_PAN_PIXELS,
  KEYBOARD_ZOOM_FACTOR,
  labelBoxesOverlap,
  lineHeightForFile,
  lineAtWorldPoint,
  latestActivityByAgent,
  mapHoverLabel,
  mapRouteFocusAction,
  mapRouteTarget,
  mapSearchAction,
  mapSearchMatch,
  mapSelectionPanel,
  mapTargetSelectionAction,
  normalizeActivityState,
  organicTrailSegments,
  organicRegionPoints,
  organicRegionStyle,
  panViewForDrag,
  panViewByScreenDelta,
  reconciledSelectedTarget,
  screenBoundsForView,
  screenToWorldPoint,
  shouldDrawFolder,
  shouldDrawOrganicRegion,
  shouldLabelFile,
  shouldLabelFolder,
  rememberSourceRange,
  sourceContextRequest,
  sourcePanelLineRangeForBox,
  sourcePanelState,
  sourceRangeCacheKey,
  sortedActivityEvents,
  viewForBounds,
  viewForReadableFile,
  visibleLineRangeForBox,
  worldToScreenPoint,
  zoomViewAt,
} from "./render-model.js";
import {
  boundsFromRouteParams,
  createAnnotationHashRoute,
  createMapHashRoute,
  createSelectionHashRoute,
  parseHashRoute,
} from "./deep-links.js";

const canvas = document.querySelector("#mapCanvas");
const ctx = canvas.getContext("2d");
const mapArea = document.querySelector(".map-area");
const DEFAULT_MAP_LEVEL = "file";
const SAVE_AND_COPY_LABEL = "Save and copy Codex prompt";
const COPY_PROMPT_LABEL = "Copy Codex prompt";
const CAMERA_ANIMATION_MS = 280;
const DOUBLE_CLICK_ZOOM_FACTOR = 2;
const CLICK_SELECT_DELAY_MS = 220;

let frameLabels = [];
let activityPollTimer = null;
let mapPollTimer = null;
let applyingRoute = false;
let routeSequence = 0;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const state = {
  map: null,
  mapVersion: "",
  namedPlaces: [],
  overlaps: [],
  activity: [],
  sourceCache: new Map(),
  pendingSourceRequests: new Set(),
  activitySignature: "",
  view: { x: 0, y: 0, scale: 1 },
  cameraAnimation: null,
  pendingClickSelection: null,
  dragging: null,
  lastPointerDown: null,
  lastPointerType: "",
  drawing: false,
  panning: false,
  spacePanning: false,
  draftSelection: null,
  resolvedSelection: null,
  selectedTarget: null,
};

const controls = {
  summary: document.querySelector("#mapSummary"),
  hover: document.querySelector("#hoverReadout"),
  viewport: document.querySelector("#viewportReadout"),
  selectionPopover: document.querySelector("#selectionPopover"),
  annotationActions: document.querySelector("#annotationActions"),
  inspectorTitle: document.querySelector("#inspectorTitle"),
  inspectorSubtitle: document.querySelector("#inspectorSubtitle"),
  searchForm: document.querySelector("#searchForm"),
  searchInput: document.querySelector("#searchInput"),
  searchResult: document.querySelector("#searchResult"),
  selectTool: document.querySelector("#selectTool"),
  panTool: document.querySelector("#panTool"),
  zoomInTool: document.querySelector("#zoomInTool"),
  zoomOutTool: document.querySelector("#zoomOutTool"),
  resetViewTool: document.querySelector("#resetViewTool"),
  drawTool: document.querySelector("#drawTool"),
  clearActivityTool: document.querySelector("#clearActivityTool"),
  saveSelection: document.querySelector("#saveSelection"),
  deleteAnnotation: document.querySelector("#deleteAnnotation"),
  copyAnnotationPrompt: document.querySelector("#copyAnnotationPrompt"),
  deleteAnnotationAction: document.querySelector("#deleteAnnotationAction"),
  selectionComment: document.querySelector("#selectionComment"),
  selectionStatus: document.querySelector("#selectionStatus"),
  sourceTitle: document.querySelector("#sourceTitle"),
  sourceOutput: document.querySelector("#sourceOutput"),
  showFolders: document.querySelector("#showFolders"),
  showOrganicRegions: document.querySelector("#showOrganicRegions"),
  showFiles: document.querySelector("#showFiles"),
  showNames: document.querySelector("#showNames"),
  showActivity: document.querySelector("#showActivity"),
  showGrid: document.querySelector("#showGrid"),
  activityFeed: document.querySelector("#activityFeed"),
  activityForm: document.querySelector("#activityForm"),
};

await boot();

async function boot() {
  const [map, mapVersion, names, activity] = await Promise.all([
    fetchJson("/api/map"),
    fetchJson("/api/map-version"),
    fetchJson("/api/named-places"),
    fetchJson("/api/activity"),
  ]);
  applyMap(map, mapVersion.version);
  state.namedPlaces = names.places;
  state.overlaps = names.overlaps ?? [];
  state.activity = activity.events;
  state.activitySignature = activitySignature(state.activity);
  bindEvents();
  startMapPolling();
  startActivityPolling();
  resize();
  await applyHashRoute();
  render();
}

function applyMap(map, version) {
  const previousSelection = state.selectedTarget;
  state.map = map;
  state.mapVersion = version ?? state.mapVersion;
  state.sourceCache.clear();
  state.pendingSourceRequests.clear();
  if (controls.summary) {
    controls.summary.textContent = `${Object.keys(map.files).length} files, ${Object.keys(map.folders).length} folders`;
  }
  reconcileSelectedTarget(previousSelection);
}

function reconcileSelectedTarget(target) {
  state.selectedTarget = reconciledSelectedTarget(state.map, target);
}

function bindEvents() {
  window.addEventListener("resize", () => {
    resize();
    render();
  });
  window.addEventListener("hashchange", () => {
    void applyHashRoute();
  });
  document.addEventListener("keydown", onDocumentKeyDown);
  document.addEventListener("keyup", onDocumentKeyUp);
  window.addEventListener("blur", () => setSpacePanMode(false));

  for (const control of [
    controls.showFolders,
    controls.showOrganicRegions,
    controls.showFiles,
    controls.showNames,
    controls.showActivity,
    controls.showGrid,
  ].filter(Boolean)) {
    control.addEventListener("change", render);
  }

  controls.selectTool?.addEventListener("click", () => {
    setSelectMode();
    render();
  });
  controls.drawTool?.addEventListener("click", () => {
    setDrawMode(!state.drawing);
    render();
  });
  controls.panTool?.addEventListener("click", () => {
    setPanMode();
    render();
  });
  controls.zoomInTool?.addEventListener("click", () => zoomAt(viewportCenter(), KEYBOARD_ZOOM_FACTOR, { animate: true }));
  controls.zoomOutTool?.addEventListener("click", () => zoomAt(viewportCenter(), 1 / KEYBOARD_ZOOM_FACTOR, { animate: true }));
  controls.resetViewTool?.addEventListener("click", () => fitCodebaseView({ animate: true }));

  controls.searchForm?.addEventListener("submit", searchMap);
  controls.saveSelection?.addEventListener("click", saveSelection);
  controls.deleteAnnotation?.addEventListener("click", deleteSelectedAnnotation);
  controls.copyAnnotationPrompt?.addEventListener("click", copySelectedAnnotationPrompt);
  controls.deleteAnnotationAction?.addEventListener("click", deleteSelectedAnnotation);
  controls.activityForm?.addEventListener("submit", addActivity);
  controls.clearActivityTool?.addEventListener("click", clearActivityHistory);

  mapArea.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerUp);
  canvas.addEventListener("dblclick", onCanvasDoubleClick);
  canvas.addEventListener("blur", () => canvas.classList.remove("pointer-focused"));
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "application");
  canvas.setAttribute("aria-label", "CodeCharter map canvas. Use the pointer tool to select items, the hand tool or Space drag to pan, arrow keys to pan, plus and minus to zoom, double click to zoom in, 0 to fit the codebase, Enter to select the center, and Escape to cancel the current action.");
  canvas.addEventListener("keydown", onCanvasKeyDown);
  updateInteractionModeUi();
}

function startActivityPolling() {
  if (activityPollTimer) clearInterval(activityPollTimer);
  activityPollTimer = setInterval(refreshActivity, 1800);
}

function startMapPolling() {
  if (mapPollTimer) clearInterval(mapPollTimer);
  mapPollTimer = setInterval(refreshMap, 1800);
}

async function refreshMap() {
  try {
    const mapVersion = await fetchJson("/api/map-version");
    if (!mapVersion.version || mapVersion.version === state.mapVersion) return;
    const [map, names] = await Promise.all([
      fetchJson("/api/map"),
      fetchJson("/api/named-places"),
    ]);
    applyMap(map, mapVersion.version);
    state.namedPlaces = names.places;
    state.overlaps = names.overlaps ?? [];
    render();
  } catch (error) {
    console.error(error);
  }
}

async function refreshActivity() {
  try {
    const activity = await fetchJson("/api/activity");
    const nextSignature = activitySignature(activity.events ?? []);
    if (nextSignature === state.activitySignature) {
      if ((activity.events ?? []).length) render();
      return;
    }
    state.activity = activity.events ?? [];
    state.activitySignature = nextSignature;
    render();
  } catch (error) {
    console.error(error);
  }
}

function activitySignature(events) {
  const latest = events.at(-1);
  return `${events.length}:${latest?.id ?? ""}:${latest?.timestamp ?? ""}`;
}

const HASH_ROUTE_FOCUS_HANDLERS = {
  annotation: (intent, routeToken) => focusAnnotationRoute(intent.id, routeToken),
  selection: (intent, routeToken) => focusSelectionRoute(intent.params, routeToken),
  map: (intent, routeToken) => focusMapRoute(intent.route, routeToken),
};

const MAP_ROUTE_FOCUS_HANDLERS = {
  focusFile: (target, route, routeToken) => showFileForRoute(target, route.params, routeToken),
  focusFolder: (target) => {
    clearAnnotationForm();
    setText(controls.inspectorTitle, folderDisplayName(target));
    setText(controls.inspectorSubtitle, `folder: ${target.path || "."} | ${target.geo.geohash}`);
    render();
  },
};

const DOUBLE_CLICK_ACTION_HANDLERS = {
  focusAnnotation: (hit) => {
    zoomToBounds(hit.geometry.bounds, 1.28);
    selectAnnotation(hit);
  },
  selectFolder: (hit, world) => {
    void selectMapTarget(world);
    zoomToBounds(hit.bounds, 1.35);
  },
  selectFile: (_hit, world) => {
    void selectMapTarget(world);
  },
  selectActivity: (hit) => {
    void selectActivityEvent(hit);
  },
};

const MAP_TARGET_SELECTION_HANDLERS = {
  clearSelection: clearMapSelection,
  focusAnnotation: (hit) => {
    zoomToBounds(hit.geometry.bounds, 1.35);
    selectAnnotation(hit);
  },
  selectActivity: (hit) => selectActivityEvent(hit),
  inspectFolder: inspectFolderTarget,
  inspectFile: inspectFileTarget,
};

const MAP_SEARCH_ACTION_HANDLERS = {
  noMatch: () => {
    setSearchResult("No matching place found.");
  },
  focusPlace: (match) => {
    zoomToBounds(match.place.geometry.bounds, 1.35);
    setSearchResult(match.label);
    state.selectedTarget = match.target;
    if (state.selectedTarget?.targetType === "annotation") selectAnnotation(state.selectedTarget);
    render();
  },
  focusFile: async (match) => {
    zoomToReadableFile(match.file);
    await selectMapTarget(boundsCenter(match.file.bounds));
    setSearchResult(match.label);
  },
  focusFolder: (match) => {
    zoomToBounds(match.folder.bounds, 1.6);
    state.selectedTarget = { ...match.folder, targetType: "folder" };
    setText(controls.inspectorTitle, folderDisplayName(match.folder));
    setText(controls.inspectorSubtitle, `folder: ${match.folder.path || "."} | ${match.folder.geo.geohash}`);
    setSearchResult(match.label);
    render();
  },
};

async function applyHashRoute() {
  const routeToken = ++routeSequence;
  const route = parseHashRoute(window.location.hash);
  const intent = hashRouteFocusIntent(route, { hasMap: Boolean(state.map) });
  if (!intent) return;

  applyingRoute = true;
  try {
    await HASH_ROUTE_FOCUS_HANDLERS[intent.type]?.(intent, routeToken);
  } finally {
    if (routeToken === routeSequence) applyingRoute = false;
  }
}

async function focusAnnotationRoute(id, routeToken) {
  let annotation = state.namedPlaces.find((place) => place.kind === "mapAnnotation" && place.id === id);
  if (!annotation) {
    try {
      annotation = (await fetchJson(`/api/annotations/${encodeURIComponent(id)}`)).annotation;
    } catch {
      return;
    }
  }
  if (!isCurrentRoute(routeToken)) return;
  if (!annotation?.geometry?.bounds) return;
  upsertNamedPlace(annotation);
  resetSelectionOverlay();
  zoomToBounds(annotation.geometry.bounds, 1.35);
  selectAnnotation(annotation);
}

async function focusSelectionRoute(params, routeToken) {
  const bounds = boundsFromRouteParams(params);
  if (!bounds) return;
  resetSelectionOverlay();
  state.drawing = true;
  updateInteractionModeUi();
  state.selectedTarget = null;
  setText(controls.sourceTitle, "");
  setText(controls.sourceOutput, "");
  state.draftSelection = { type: "rect", bounds };
  zoomToBounds(bounds, 1.35);
  await previewSelection({ routeToken });
}

async function focusMapRoute(route, routeToken) {
  const target = mapRouteTarget(state.map, route);
  const action = mapRouteFocusAction(target);
  if (!action) return;

  resetSelectionOverlay();
  zoomToBounds(target.bounds, action.zoomPadding);
  state.selectedTarget = target;
  await MAP_ROUTE_FOCUS_HANDLERS[action.type]?.(target, route, routeToken);
}

async function showFileForRoute(file, params, routeToken) {
  clearAnnotationForm();
  setText(controls.inspectorTitle, file.name);
  setText(controls.inspectorSubtitle, `file: ${file.path} | ${file.geo.geohash}`);

  const lineRange = parseLineRange(params.get("lines"));
  if (!lineRange) {
    applySourcePanel(sourcePanelState({ path: file.path }));
    render();
    return;
  }

  const sourceContext = sourceContextRequest(file.path, lineRange);
  const [address, source] = await Promise.all([
    fetchJson(sourceContext.resolveUrl),
    fetchJson(sourceContext.sourceUrl),
  ]);
  if (!isCurrentRoute(routeToken)) return;
  applySourcePanel(sourcePanelState({ path: file.path, deepLink: address.deepLink, source }));
  render();
}

function syncHashRoute(hash) {
  if (applyingRoute || !hash || window.location.hash === hash) return;
  window.history.replaceState(null, "", hash);
}

function isCurrentRoute(routeToken) {
  return routeToken === routeSequence;
}

function setDrawMode(enabled) {
  state.drawing = enabled;
  state.panning = false;
  if (enabled) state.selectedTarget = null;
  if (!enabled) clearDraftSelection();
  updateInteractionModeUi();
  setSelectionStatus(enabled ? "Draw mode on." : "Draw mode off.");
  updateSelectionPopover();
}

function setSelectMode() {
  state.panning = false;
  state.drawing = false;
  clearDraftSelection();
  updateInteractionModeUi();
  setSelectionStatus("");
  updateSelectionPopover();
}

function setPanMode() {
  state.panning = true;
  state.drawing = false;
  clearDraftSelection();
  updateInteractionModeUi();
  setSelectionStatus("Pan mode on.");
  updateSelectionPopover();
}

function setSpacePanMode(enabled) {
  if (state.spacePanning === enabled) return;
  state.spacePanning = enabled;
  updateInteractionModeUi();
}

function updateInteractionModeUi() {
  const mode = interactionModeUiState(state);
  controls.selectTool?.classList.toggle("active", mode.selectActive);
  controls.selectTool?.setAttribute("aria-pressed", String(mode.selectActive));
  controls.panTool?.classList.toggle("active", mode.panActive);
  controls.panTool?.setAttribute("aria-pressed", String(mode.panActive));
  controls.drawTool?.classList.toggle("active", mode.drawActive);
  controls.drawTool?.setAttribute("aria-pressed", String(mode.drawActive));
  canvas.classList.toggle("is-panning-mode", mode.panningMode);
  canvas.classList.toggle("is-drawing", mode.drawingMode);
  canvas.classList.toggle("is-space-panning", mode.spacePanningMode);
  canvas.classList.toggle("is-panning", mode.panning);
}

function clearDraftSelection() {
  state.dragging = null;
  state.draftSelection = null;
  state.resolvedSelection = null;
  if (controls.saveSelection) controls.saveSelection.disabled = true;
  setSaveButtonLabel();
  updateSelectionPopover();
}

function resetSelectionOverlay() {
  state.dragging = null;
  state.drawing = false;
  state.panning = false;
  state.draftSelection = null;
  state.resolvedSelection = null;
  if (controls.selectionComment) controls.selectionComment.value = "";
  if (controls.saveSelection) controls.saveSelection.disabled = true;
  if (controls.deleteAnnotation) controls.deleteAnnotation.hidden = true;
  setSaveButtonLabel();
  setSelectionStatus("");
  updateInteractionModeUi();
  updateSelectionPopover();
}

function upsertNamedPlace(place) {
  const index = state.namedPlaces.findIndex((candidate) => candidate.id === place.id);
  if (index === -1) {
    state.namedPlaces.push(place);
  } else {
    state.namedPlaces[index] = place;
  }
}

function updateSelectionPopover() {
  const selectedAnnotation = state.selectedTarget?.targetType === "annotation";
  const hasDraft = Boolean(state.draftSelection || state.resolvedSelection);
  if (controls.selectionPopover) controls.selectionPopover.hidden = !hasDraft;
  if (controls.annotationActions) controls.annotationActions.hidden = !selectedAnnotation || hasDraft;
  if (controls.deleteAnnotation) controls.deleteAnnotation.hidden = !selectedAnnotation;
  if (controls.saveSelection) {
    controls.saveSelection.disabled = !(state.resolvedSelection || selectedAnnotation);
    setSaveButtonLabel(selectedAnnotation ? COPY_PROMPT_LABEL : SAVE_AND_COPY_LABEL);
  }
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function render() {
  const rect = canvas.getBoundingClientRect();
  frameLabels = [];
  ctx.clearRect(0, 0, rect.width, rect.height);
  controls.viewport.textContent = `scale ${state.view.scale.toFixed(2)} | level ${DEFAULT_MAP_LEVEL}`;

  drawCompassRose();
  if (layerEnabled("showGrid", false)) drawGrid();
  if (layerEnabled("showFolders")) drawFolders();
  if (layerEnabled("showOrganicRegions")) drawOrganicRegions();
  if (layerEnabled("showFiles")) drawFiles();
  drawQueuedLabels();
  if (layerEnabled("showNames")) drawNamedPlaces();
  if (layerEnabled("showNames")) drawOverlaps();
  if (state.draftSelection) drawSelection(state.draftSelection.bounds, "rgba(245, 158, 11, 0.18)", "#f59e0b", [6, 4]);
  if (layerEnabled("showActivity")) drawActivity();
  renderActivityFeed();
}

function layerEnabled(name, fallback = true) {
  return controls[name]?.checked ?? fallback;
}

function drawGrid() {
  const step = 0.1;
  ctx.save();
  ctx.strokeStyle = "rgba(15, 23, 42, 0.12)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 10; i += 1) {
    const p = worldToScreen({ x: i * step, y: i * step });
    ctx.beginPath();
    ctx.moveTo(p.x, 0);
    ctx.lineTo(p.x, canvas.clientHeight);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p.y);
    ctx.lineTo(canvas.clientWidth, p.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCompassRose() {
  ctx.save();
  ctx.fillStyle = "rgba(18, 61, 53, 0.08)";
  ctx.strokeStyle = "rgba(18, 61, 53, 0.16)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(canvas.clientWidth - 44, canvas.clientHeight - 44, 22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.fillText("N", canvas.clientWidth - 48, canvas.clientHeight - 50);
  ctx.fillText("Code Plane", canvas.clientWidth - 96, canvas.clientHeight - 16);
  ctx.restore();
}

function drawFolders() {
  for (const folder of Object.values(state.map.folders)) {
    if (!folder.path) continue;
    const box = screenBounds(folder.bounds);
    if (!visible(box)) continue;
    const depth = folderDepth(folder.path);
    if (!shouldDrawFolder(state.view.scale, depth, box)) continue;
    const style = folderStyle(folder.path, depth);
    ctx.fillStyle = style.fill;
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = depth === 1 ? 2.1 : 1;
    drawRect(box);
    if (shouldLabelFolder(state.view.scale, depth, box)) {
      queueLabelInBox({
        text: folderDisplayName(folder),
        box,
        color: style.label,
        size: 13,
        weight: "600",
        priority: folderLabelPriority(depth, box),
      });
    }
  }
}

function drawOrganicRegions() {
  const folders = Object.values(state.map.folders)
    .filter((folder) => folder.path)
    .sort((a, b) => folderDepth(a.path) - folderDepth(b.path) || a.path.localeCompare(b.path));

  for (const folder of folders) {
    const box = screenBounds(folder.bounds);
    if (!visible(box)) continue;
    const depth = folderDepth(folder.path);
    if (!shouldDrawOrganicRegion(state.view.scale, depth, box)) continue;
    const points = organicRegionPoints(folder.bounds, folder.path, depth);
    if (points.length < 3) continue;
    const style = organicRegionStyle(folder.path, depth);

    ctx.save();
    drawOrganicPath(points);
    ctx.fillStyle = style.fill;
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = depth === 1 ? 2.4 : 1.4;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function drawFiles() {
  let renderedSourceLines = 0;
  for (const file of Object.values(state.map.files)) {
    const box = screenBounds(file.bounds);
    if (!visible(box)) continue;
    const selected = state.selectedTarget?.path === file.path;
    const visualState = fileVisualState({ file, box, scale: state.view.scale, selected });
    if (visualState === "hidden") continue;

    ctx.fillStyle = selected ? "rgba(255, 255, 255, 0.82)" : "rgba(235, 248, 241, 0.48)";
    ctx.strokeStyle = selected
      ? "rgba(180, 84, 24, 0.95)"
      : visualState === "aggregate"
        ? "rgba(18, 128, 98, 0.16)"
        : "rgba(18, 128, 98, 0.34)";
    ctx.lineWidth = selected ? 2.6 : visualState === "aggregate" ? 0.35 : state.view.scale > 2.2 ? 1 : 0.65;
    drawRect(box);
    if (shouldLabelFile({ file, box, scale: state.view.scale, selected })) {
      queueLabelInBox({
        text: file.name,
        box,
        color: "rgba(3, 87, 67, 0.84)",
        size: 12,
        weight: "500",
        priority: fileLabelPriority({ file, selected }),
      });
    }
    if (canRenderSourceText(file, box) && renderedSourceLines < SOURCE_TEXT_MAX_LINES_PER_FRAME) {
      renderedSourceLines += drawSourceText(file, box, SOURCE_TEXT_MAX_LINES_PER_FRAME - renderedSourceLines);
    } else if (state.view.scale > 6 && box.height > 34) {
      drawLineBands(file, box);
    }
  }
}

function drawOrganicPath(points) {
  const first = worldToScreen(points[0]);
  const second = worldToScreen(points[1]);
  ctx.beginPath();
  ctx.moveTo((first.x + second.x) / 2, (first.y + second.y) / 2);

  for (let index = 1; index <= points.length; index += 1) {
    const control = worldToScreen(points[index % points.length]);
    const next = worldToScreen(points[(index + 1) % points.length]);
    ctx.quadraticCurveTo(control.x, control.y, (control.x + next.x) / 2, (control.y + next.y) / 2);
  }

  ctx.closePath();
}

function drawSourceText(file, box, remainingBudget) {
  const visibleRange = visibleLineRange(file, box);
  if (!visibleRange) return 0;

  const budgetedEnd = Math.min(visibleRange.end, visibleRange.start + remainingBudget - 1);
  const fetchStart = Math.max(1, visibleRange.start - SOURCE_TEXT_PREFETCH_LINES);
  const fetchEnd = Math.min(file.lineCount, budgetedEnd + SOURCE_TEXT_PREFETCH_LINES);
  const cacheKey = sourceRangeCacheKey(file.path, fetchStart, fetchEnd);
  const cached = cachedSourceRange(state.sourceCache, file.path, fetchStart, fetchEnd);

  if (!cached) {
    requestSourceRange(file.path, fetchStart, fetchEnd, cacheKey);
    drawSourcePlaceholder(box);
    return 0;
  }

  const linesByNumber = new Map(cached.lines.map((line) => [line.number, line.text]));
  const lineHeight = lineHeightForFile(file, box);
  const firstBaseline = box.y + (visibleRange.start - 1) * lineHeight + Math.min(13, lineHeight * 0.78);
  const maxChars = Math.max(12, Math.floor((box.width - 44) / 7.2));
  let drawn = 0;

  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.width, box.height);
  ctx.clip();
  ctx.font = "12px SFMono-Regular, Consolas, Liberation Mono, monospace";
  ctx.textBaseline = "alphabetic";

  for (let lineNumber = visibleRange.start; lineNumber <= budgetedEnd; lineNumber += 1) {
    const y = firstBaseline + drawn * lineHeight;
    if (y > box.y + box.height) break;
    const text = linesByNumber.get(lineNumber) ?? "";
    ctx.fillStyle = "rgba(63, 83, 97, 0.58)";
    ctx.fillText(String(lineNumber).padStart(4, " "), box.x + 6, y);
    ctx.fillStyle = "rgba(12, 34, 48, 0.86)";
    ctx.fillText(truncateLine(text, maxChars), box.x + 42, y);
    drawn += 1;
  }

  ctx.restore();
  return drawn;
}

function drawSourcePlaceholder(box) {
  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.36)";
  ctx.fillRect(box.x + 4, box.y + 4, Math.max(0, box.width - 8), Math.min(24, Math.max(0, box.height - 8)));
  ctx.restore();
}

function visibleLineRange(file, box) {
  return visibleLineRangeForBox(file, box, canvas.clientHeight);
}

function requestSourceRange(path, lineStart, lineEnd, cacheKey) {
  if (state.pendingSourceRequests.has(cacheKey)) return;
  state.pendingSourceRequests.add(cacheKey);
  fetchJson(sourceContextRequest(path, { start: lineStart, end: lineEnd }).sourceUrl)
    .then((source) => {
      rememberSourceRange(state.sourceCache, cacheKey, source);
      render();
    })
    .catch((error) => {
      console.error(error);
    })
    .finally(() => {
      state.pendingSourceRequests.delete(cacheKey);
    });
}

function truncateLine(text, maxChars) {
  return text.length > maxChars ? `${text.slice(0, Math.max(0, maxChars - 3))}...` : text;
}

function drawLineBands(file, box) {
  const lines = Math.min(file.lineCount, 80);
  ctx.strokeStyle = "rgba(4, 120, 87, 0.18)";
  ctx.lineWidth = 1;
  for (let i = 1; i < lines; i += 1) {
    const y = box.y + (box.height * i) / lines;
    ctx.beginPath();
    ctx.moveTo(box.x, y);
    ctx.lineTo(box.x + box.width, y);
    ctx.stroke();
  }
}

function drawNamedPlaces() {
  const annotations = [];
  for (const place of state.namedPlaces) {
    if (place.kind === "mapAnnotation") {
      annotations.push(place);
      continue;
    }
    if (place.kind !== "drawnSelection") continue;
    drawSelection(place.geometry.bounds, "rgba(245, 158, 11, 0.08)", "#f59e0b", []);
    const box = screenBounds(place.geometry.bounds);
    drawLabel(place.name, box.x + 6, box.y + 16, "#92400e");
  }

  annotations.forEach((annotation, index) => {
    const selected = state.selectedTarget?.targetType === "annotation" && state.selectedTarget.id === annotation.id;
    drawAnnotation(annotation, index + 1, selected);
  });
}

function drawAnnotation(annotation, markerNumber, selected) {
  drawAnnotationMembrane(
    annotation.geometry.bounds,
    selected ? "rgba(37, 99, 235, 0.13)" : "rgba(37, 99, 235, 0.07)",
    selected ? "#1d4ed8" : "rgba(37, 99, 235, 0.8)",
    selected,
    annotation.id ?? annotation.name,
  );

  const box = screenBounds(annotation.geometry.bounds);
  if (box.width > 68 && box.height > 22) {
    drawLabel(annotation.name, box.x + 8, box.y + 18, "#1e3a8a", 12, "700");
  }
  drawAnnotationMarker(annotation, markerNumber, selected);
}

function drawAnnotationMembrane(bounds, fill, stroke, selected, key) {
  const points = organicRegionPoints(bounds, `annotation:${key}`, 0);
  if (points.length < 3) return;

  ctx.save();
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = selected ? 2.5 : 1.6;
  if (!selected) ctx.setLineDash([6, 5]);
  drawOrganicPath(points);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawAnnotationMarker(annotation, markerNumber, selected) {
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

function drawOverlaps() {
  for (const overlap of state.overlaps) {
    const box = screenBounds(overlap.bounds);
    if (!visible(box)) continue;
    ctx.save();
    ctx.fillStyle = "rgba(225, 29, 72, 0.18)";
    ctx.strokeStyle = "#e11d48";
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    drawRect(box);
    ctx.restore();
    if (box.width > 44 && box.height > 16) drawLabel("Overlap", box.x + 6, box.y + 16, "#9f1239");
  }
}

function drawActivity() {
  const events = sortedActivityEvents(state.activity);
  const latestByAgent = latestActivityByAgent(events);
  drawActivityMembranes(events, latestByAgent);
  drawActivityTrails(events, latestByAgent);

  for (const event of events) {
    const latest = latestByAgent.get(activityActorKey(event)) === event;
    const primaryBounds = activityPrimaryBounds(event);
    if (!primaryBounds) continue;
    const center = boundsCenter(primaryBounds);
    const p = worldToScreen(center);
    const selected = state.selectedTarget?.targetType === "activity" && state.selectedTarget.id === event.id;
    const encoding = activityVisualEncoding(event, { latest, selected });
    const style = activityStateStyle(encoding.activityState);
    const fillColor = activityFillColor(style, encoding);
    const haloColor = activityHaloColor(style, encoding);
    ctx.save();
    ctx.globalAlpha = encoding.alpha;
    ctx.fillStyle = haloColor;
    ctx.beginPath();
    ctx.arc(p.x, p.y, encoding.haloRadius * 0.46, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = fillColor;
    ctx.strokeStyle = selected ? "#111827" : haloColor;
    ctx.lineWidth = selected ? 3 : latest ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, encoding.coreRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (latest && (encoding.active || selected)) {
      ctx.globalAlpha = encoding.membraneAlpha * 1.25;
      ctx.beginPath();
      drawActivityCell(p, encoding.haloRadius, event.id ?? event.agentId);
      ctx.strokeStyle = fillColor;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.globalAlpha = 1;
      const label = encoding.active
        ? `${activityActorLabel(event)}: ${encoding.activityState}`
        : `${activityActorLabel(event)}: last seen ${formatActivityAge(encoding.ageMinutes)}`;
      drawLabel(label, p.x + 10, p.y - 8, encoding.active ? style.label : "#475569", 12, "700");
    }
    ctx.restore();
  }
}

function drawActivityMembranes(events, latestByAgent) {
  for (const event of events) {
    const latest = latestByAgent.get(activityActorKey(event)) === event;
    const selected = state.selectedTarget?.targetType === "activity" && state.selectedTarget.id === event.id;
    const encoding = activityVisualEncoding(event, { latest, selected });
    if (encoding.membraneAlpha <= 0.08 && !selected) continue;

    const style = activityStateStyle(encoding.activityState);
    const fillColor = activityFillColor(style, encoding);

    for (const bounds of activityFragmentBounds(event)) {
      const tissueBox = activityTissueBox(screenBounds(bounds), encoding);
      const p = {
        x: tissueBox.x + tissueBox.width / 2,
        y: tissueBox.y + tissueBox.height / 2,
      };
      const radius = Math.max(tissueBox.width, tissueBox.height) * 0.82;
      const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
      gradient.addColorStop(0, hexToRgba(fillColor, encoding.membraneAlpha));
      gradient.addColorStop(0.58, hexToRgba(fillColor, encoding.membraneAlpha * 0.45));
      gradient.addColorStop(1, hexToRgba(fillColor, 0));

      ctx.save();
      ctx.fillStyle = gradient;
      ctx.beginPath();
      drawActivityTissue(tissueBox, `${event.id ?? event.agentId}:${bounds.x}:${bounds.y}`);
      ctx.fill();
      ctx.restore();
    }
  }
}

function drawActivityTrails(events, latestByAgent) {
  for (const agentEvents of activityTrailGroups(events)) {
    const trailLatest = agentEvents.at(-1);
    const latest = latestByAgent.get(activityActorKey(trailLatest)) === trailLatest;
    const selected = activityTrailSelected(agentEvents);
    const encoding = activityVisualEncoding(trailLatest, { latest, selected });
    const style = activityStateStyle(encoding.activityState);
    const fillColor = activityFillColor(style, encoding);
    const pointGroups = activityTrailPointGroups(activityTrailPoints(agentEvents));
    if (pointGroups.length === 0) continue;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash([]);
    ctx.shadowColor = hexToRgba(fillColor, encoding.trailAlpha * 0.3);
    ctx.shadowBlur = encoding.dormant ? 0 : selected ? 12 : 7;

    for (const points of pointGroups) {
      strokeOrganicTrail(points, {
        color: hexToRgba(fillColor, encoding.trailAlpha * 0.16),
        lineWidth: encoding.lineWidth * 5.4,
      });
    }
    ctx.shadowBlur = 0;
    for (const points of pointGroups) {
      strokeOrganicTrail(points, {
        color: hexToRgba(fillColor, encoding.trailAlpha * 0.38),
        lineWidth: encoding.lineWidth * 2.25,
      });
      strokeOrganicTrail(points, {
        color: hexToRgba(fillColor, Math.min(0.9, encoding.trailAlpha * 0.95)),
        lineWidth: encoding.lineWidth,
      });
    }
    ctx.restore();
  }
}

function activityTrailSelected(events) {
  if (state.selectedTarget?.targetType !== "activity") return false;
  return events.some((event) => event.id === state.selectedTarget.id);
}

function activityTrailPoints(events) {
  return events
    .map((event) => activityPrimaryBounds(event))
    .filter(Boolean)
    .map((bounds) => worldToScreen(boundsCenter(bounds)));
}

function strokeOrganicTrail(points, { color, lineWidth }) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  if (drawMyceliumPath(points)) ctx.stroke();
}

function drawMyceliumPath(points) {
  if (points.length < 2) return;

  const minDistance = Math.min(14, Math.max(6, state.view.scale * 2.2));
  const segments = organicTrailSegments(points, { minDistance });
  if (segments.length === 0) return false;

  ctx.moveTo(segments[0].start.x, segments[0].start.y);
  for (const segment of segments) {
    ctx.bezierCurveTo(
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

function drawActivityCell(center, radius, key) {
  const points = 10;
  ctx.moveTo(center.x + radius, center.y);
  for (let index = 1; index <= points; index += 1) {
    const angle = (index / points) * Math.PI * 2;
    const wobble = 0.82 + hashUnit(`${key}:cell:${index}`) * 0.26;
    const r = radius * wobble;
    ctx.lineTo(center.x + Math.cos(angle) * r, center.y + Math.sin(angle) * r);
  }
  ctx.closePath();
}

function drawActivityTissue(box, key) {
  const center = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
  const radiusX = box.width / 2;
  const radiusY = box.height / 2;
  const points = 14;
  ctx.moveTo(center.x + radiusX, center.y);
  for (let index = 1; index <= points; index += 1) {
    const angle = (index / points) * Math.PI * 2;
    const wobble = 0.86 + hashUnit(`${key}:tissue:${index}`) * 0.22;
    ctx.lineTo(
      center.x + Math.cos(angle) * radiusX * wobble,
      center.y + Math.sin(angle) * radiusY * wobble,
    );
  }
  ctx.closePath();
}

function activityFillColor(style, encoding) {
  return encoding.active || encoding.selected ? style.fill : "#64748b";
}

function activityHaloColor(style, encoding) {
  return encoding.active || encoding.selected ? style.stroke : "#cbd5e1";
}

function formatActivityAge(ageMinutes) {
  if (ageMinutes < 60) return `${Math.max(1, Math.round(ageMinutes))}m ago`;
  return `${Math.round(ageMinutes / 60)}h ago`;
}

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const rgb = [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function hashUnit(value) {
  return hashString(value) / 0xffffffff;
}

function renderActivityFeed() {
  if (!controls.activityFeed) return;
  const latest = [...latestActivityByAgent(state.activity).values()]
    .sort((a, b) => Date.parse(b.timestamp ?? 0) - Date.parse(a.timestamp ?? 0));

  controls.activityFeed.replaceChildren();
  if (latest.length === 0) {
    controls.activityFeed.textContent = "No activity yet.";
    return;
  }

  for (const event of latest.slice(0, 5)) {
    const item = document.createElement("button");
    item.className = "activity-item";
    item.type = "button";
    item.addEventListener("click", () => selectActivityEvent(event));
    const encoding = activityVisualEncoding(event, { latest: true });

    const title = document.createElement("strong");
    title.textContent = encoding.active
      ? `${activityActorLabel(event)}: ${normalizeActivityState(event.activityState)}`
      : `${activityActorLabel(event)}: last seen ${formatActivityAge(encoding.ageMinutes)}`;
    const detail = document.createElement("span");
    detail.textContent = activityPathLabel(event);
    item.append(title, detail);
    controls.activityFeed.append(item);
  }
}

function drawSelection(bounds, fill, stroke, dash) {
  const box = screenBounds(bounds);
  ctx.save();
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.setLineDash(dash);
  drawRect(box);
  ctx.restore();
}

function drawRect(box) {
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.width, box.height);
  ctx.fill();
  ctx.stroke();
}

function drawLabel(text, x, y, color, size = 12, weight = "400") {
  ctx.save();
  ctx.font = `${weight} ${size}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, x, y);
  ctx.restore();
}

function queueLabelInBox(label) {
  const placement = labelPlacement(label.text, label.box, label.size, label.weight);
  if (!placement) return;
  frameLabels.push({ ...label, ...placement });
}

function drawQueuedLabels() {
  const placed = [];
  frameLabels.sort((a, b) => b.priority - a.priority);
  for (const label of frameLabels) {
    if (placed.some((other) => labelBoxesOverlap(label.collisionBox, other))) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(label.box.x, label.box.y, label.box.width, label.box.height);
    ctx.clip();
    drawLabel(label.text, label.x, label.y, label.color, label.size, label.weight);
    ctx.restore();
    placed.push(label.collisionBox);
  }
}

function labelPlacement(text, box, size = 12, weight = "400") {
  const area = screenIntersection(box);
  if (!area || area.width < 56 || area.height < size + 8) return null;

  ctx.save();
  ctx.font = `${weight} ${size}px Inter, system-ui, sans-serif`;
  const width = Math.min(area.width - 12, ctx.measureText(text).width);
  ctx.restore();

  const x = clamp(box.x + 8, area.x + 8, area.x + Math.max(8, area.width - width - 6));
  const naturalY = box.y + size + 5;
  const stickyY = area.y + Math.min(Math.max(size + 8, area.height * 0.35), Math.max(size + 8, area.height - 8));
  const y = clamp(naturalY < area.y + size + 6 ? stickyY : naturalY, area.y + size + 6, area.y + area.height - 8);

  return {
    x,
    y,
    collisionBox: {
      x: x - 3,
      y: y - size - 4,
      width: width + 8,
      height: size + 8,
    },
  };
}

function onWheel(event) {
  event.preventDefault();
  cancelCameraAnimation();
  const mouse = screenPoint(event);
  if (event.ctrlKey || event.metaKey) {
    zoomAt(mouse, Math.exp(-normalizeWheelDelta(event.deltaY, event.deltaMode) * 0.0025));
  } else {
    panByWheel(event);
  }
  render();
}

function zoomAt(screenAnchor, factor, { animate = false } = {}) {
  const nextView = zoomViewAt(state.view, screenAnchor, factor, viewportSize());
  if (animate) animateViewTo(nextView);
  else setViewImmediate(nextView);
}

function panByWheel(event) {
  const deltaX = normalizeWheelDelta(event.deltaX, event.deltaMode);
  const deltaY = normalizeWheelDelta(event.deltaY, event.deltaMode);
  state.view = panViewByScreenDelta(state.view, { x: deltaX, y: deltaY }, viewportSize());
}

function normalizeWheelDelta(delta, deltaMode) {
  if (!Number.isFinite(delta)) return 0;
  if (deltaMode === WheelEvent.DOM_DELTA_LINE) return delta * 16;
  if (deltaMode === WheelEvent.DOM_DELTA_PAGE) return delta * canvas.clientHeight;
  return delta;
}

function onCanvasKeyDown(event) {
  canvas.classList.remove("pointer-focused");
  const action = canvasKeyboardAction(event);
  if (!action) return;
  event.preventDefault();

  if (action.type === "pan") {
    animateViewTo(panViewByScreenDelta(state.view, action.delta, viewportSize()));
    return;
  }

  if (action.type === "zoomIn") {
    zoomAt(viewportCenter(), KEYBOARD_ZOOM_FACTOR, { animate: true });
    return;
  }

  if (action.type === "zoomOut") {
    zoomAt(viewportCenter(), 1 / KEYBOARD_ZOOM_FACTOR, { animate: true });
    return;
  }

  if (action.type === "fitCodebase") {
    fitCodebaseView({ animate: true });
    return;
  }

  if (action.type === "selectCenter") {
    selectMapTarget(screenToWorld(viewportCenter()));
  }
}

function onDocumentKeyDown(event) {
  const action = documentKeyboardAction(event, {
    textEntry: isTextEntryTarget(event.target),
    buttonTarget: isButtonTarget(event.target),
    hasResolvedSelection: Boolean(state.resolvedSelection),
    hasSelectedAnnotation: state.selectedTarget?.targetType === "annotation",
  });
  if (!action) return;

  if (action.type === "startSpacePan") {
    event.preventDefault();
    setSpacePanMode(true);
    return;
  }

  if (action.type === "cancelInteraction") {
    event.preventDefault();
    cancelCurrentInteraction();
    return;
  }

  if (action.type === "saveSelection") {
    event.preventDefault();
    void saveSelection();
    return;
  }

  if (action.type === "copyAnnotationPrompt") {
    event.preventDefault();
    void copySelectedAnnotationPrompt();
    return;
  }

  if (action.type === "deleteAnnotation") {
    event.preventDefault();
    void deleteSelectedAnnotation();
  }
}

function onDocumentKeyUp(event) {
  if (isSpaceKeyEvent(event) && state.spacePanning) {
    event.preventDefault();
    setSpacePanMode(false);
  }
}

function isTextEntryTarget(target) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target?.isContentEditable;
}

function isButtonTarget(target) {
  return target instanceof HTMLButtonElement || target?.closest?.("button");
}

function cancelCurrentInteraction() {
  cancelPendingClickSelection();
  if (state.dragging || state.draftSelection || state.resolvedSelection || state.drawing) {
    resetSelectionOverlay();
    setSelectionStatus("Selection cancelled.");
    render();
    canvas.focus({ preventScroll: true });
    return;
  }

  if (state.selectedTarget) {
    state.selectedTarget = null;
    if (controls.selectionComment) controls.selectionComment.value = "";
    updateSelectionPopover();
    setSelectionStatus("Selection cleared.");
    render();
    canvas.focus({ preventScroll: true });
  }
}

function onPointerDown(event) {
  cancelCameraAnimation();
  if (state.dragging?.type !== "select") cancelPendingClickSelection();
  canvas.classList.add("pointer-focused");
  canvas.setPointerCapture(event.pointerId);
  canvas.focus({ preventScroll: true });
  const screen = screenPoint(event);
  const point = screenToWorld(screen);
  const spacePan = isSpacePanPointerEvent(event);
  state.lastPointerDown = { screen, world: point };
  state.lastPointerType = event.pointerType;
  if (state.drawing && !spacePan) {
    state.selectedTarget = null;
    state.dragging = { type: "draw", start: point, current: point };
    state.draftSelection = { type: "rect", bounds: { x: point.x, y: point.y, width: 0, height: 0 } };
    render();
  } else if (state.panning || spacePan) {
    state.dragging = { type: "pan", start: screenPoint(event), view: { ...state.view }, transient: spacePan };
  } else {
    state.dragging = { type: "select", start: screen, world: point };
  }
  updateInteractionModeUi();
}

function isSpacePanPointerEvent(event) {
  return state.spacePanning || Boolean(event.getModifierState?.("Space"));
}

function onPointerMove(event) {
  const screen = screenPoint(event);
  const world = screenToWorld(screen);
  const hit = hitTest(world);
  controls.hover.textContent = hit ? mapHoverLabel(hit) : `x ${world.x.toFixed(4)}, y ${world.y.toFixed(4)}`;

  if (!state.dragging) return;
  if (state.dragging.type === "select") return;
  if (state.dragging.type === "pan") {
    state.view = panViewForDrag(state.dragging, screen, viewportSize());
  } else {
    updateDraftSelection(world);
  }
  render();
}

async function onPointerUp(event) {
  if (state.dragging?.type === "draw" && state.draftSelection) {
    if (event?.type === "pointerleave") return;
    if (event) updateDraftSelection(screenToWorld(screenPoint(event)));
    if (!hasUsableDraftSelection()) {
      clearDraftSelection();
      render();
      return;
    }
    await previewSelection();
  } else if (state.dragging?.type === "select" && state.lastPointerDown && event) {
    const current = screenPoint(event);
    const moved = Math.hypot(current.x - state.lastPointerDown.screen.x, current.y - state.lastPointerDown.screen.y);
    if (moved < 4) scheduleClickSelection(state.lastPointerDown.world);
  } else if (state.dragging?.type === "pan" && state.lastPointerDown && event) {
    const current = screenPoint(event);
    const moved = Math.hypot(current.x - state.lastPointerDown.screen.x, current.y - state.lastPointerDown.screen.y);
  }
  state.dragging = null;
  updateInteractionModeUi();
}

function onCanvasDoubleClick(event) {
  if (state.drawing) return;
  event.preventDefault();
  cancelPendingClickSelection();
  const screen = screenPoint(event);
  const world = screenToWorld(screen);
  const hit = hitTestDrillTarget(world) ?? hitTestAnnotation(world);
  const action = doubleClickMapAction(hit);

  if (action) {
    DOUBLE_CLICK_ACTION_HANDLERS[action.type]?.(hit, world);
    return;
  }

  zoomAt(screen, DOUBLE_CLICK_ZOOM_FACTOR, { animate: true });
}

function scheduleClickSelection(worldPoint) {
  cancelPendingClickSelection();
  state.pendingClickSelection = window.setTimeout(() => {
    state.pendingClickSelection = null;
    void selectMapTarget(worldPoint);
  }, CLICK_SELECT_DELAY_MS);
}

function cancelPendingClickSelection() {
  if (!state.pendingClickSelection) return;
  window.clearTimeout(state.pendingClickSelection);
  state.pendingClickSelection = null;
}

function hitTestDrillTarget(world) {
  return hitTestActivity(world) ?? hitTestTargets(state.map, world);
}

function updateDraftSelection(world) {
  if (state.dragging?.type !== "draw") return;
  state.dragging.current = world;
  state.draftSelection = draftSelectionFromDrag(state.dragging.start, world);
}

function hasUsableDraftSelection() {
  return isUsableDraftSelection(state.draftSelection, {
    viewport: viewportSize(),
    scale: state.view.scale,
  });
}

async function selectMapTarget(worldPoint) {
  const hit = hitTest(worldPoint);
  const action = mapTargetSelectionAction(hit);
  await MAP_TARGET_SELECTION_HANDLERS[action.type]?.(hit, worldPoint);
}

function clearMapSelection() {
  const panel = mapSelectionPanel(null);
  state.selectedTarget = null;
  setText(controls.inspectorTitle, panel.inspectorTitle);
  setText(controls.inspectorSubtitle, panel.inspectorSubtitle);
  setText(controls.sourceTitle, panel.sourceTitle);
  setText(controls.sourceOutput, panel.sourceOutput);
  updateSelectionPopover();
  render();
}

function inspectMapTarget(hit) {
  clearAnnotationForm();
  state.selectedTarget = hit;

  const panel = mapSelectionPanel(hit);
  setText(controls.inspectorTitle, panel.inspectorTitle);
  setText(controls.inspectorSubtitle, panel.inspectorSubtitle);
  syncHashRoute(createMapHashRoute(hit.targetType, hit.geo.geohash, { path: hit.path }));
  return panel;
}

function inspectFolderTarget(hit) {
  const panel = inspectMapTarget(hit);
  setText(controls.sourceTitle, panel.sourceTitle);
  setText(controls.sourceOutput, panel.sourceOutput);
  render();
}

async function inspectFileTarget(hit, worldPoint) {
  inspectMapTarget(hit);
  const line = lineAtPoint(hit, worldPoint);
  const lineRatio = lineRatioForLine(hit, line);
  let box = screenBounds(hit.bounds);
  if (!canRenderSourceText(hit, box)) {
    const readableView = zoomToReadableFile(hit, lineRatio);
    box = screenBoundsForView(hit.bounds, readableView, viewportSize());
  }
  const lineRange = sourcePanelLineRange(hit, line, box);
  const sourceContext = sourceContextRequest(hit.path, lineRange);
  const [address, source] = await Promise.all([
    fetchJson(sourceContext.resolveUrl),
    fetchJson(sourceContext.sourceUrl),
  ]);
  syncHashRoute(createMapHashRoute(address.targetType, address.geohash, { path: hit.path, lines: sourceContext.lines }));

  applySourcePanel(sourcePanelState({ path: hit.path, deepLink: address.deepLink, source }));
  render();
}

async function selectActivityEvent(event) {
  state.selectedTarget = { ...event, targetType: "activity" };
  clearAnnotationForm();
  setText(controls.inspectorTitle, `${activityActorLabel(event)}: ${normalizeActivityState(event.activityState)}`);
  setText(controls.inspectorSubtitle, `activity: ${activityPathLabel(event)} | ${event.address.geohash}`);

  const path = pathFromActivity(event);
  if (!path) {
    applySourcePanel(sourcePanelState({
      deepLink: event.address.deepLink,
      fallbackOutput: event.note || "Activity selected.",
    }));
    render();
    return;
  }

  const lineRange = event.address.lineRange ?? { start: 1, end: undefined };
  const sourceContext = sourceContextRequest(path, lineRange);
  const source = await fetchJson(sourceContext.sourceUrl);
  applySourcePanel(sourcePanelState({ path, deepLink: event.address.deepLink, source }));
  render();
}

function selectAnnotation(annotation) {
  state.selectedTarget = { ...annotation, targetType: "annotation" };
  state.draftSelection = null;
  state.resolvedSelection = null;
  syncHashRoute(createAnnotationHashRoute(annotation.id));
  if (controls.selectionComment) controls.selectionComment.value = "";
  if (controls.saveSelection) controls.saveSelection.disabled = true;
  setSaveButtonLabel();
  updateSelectionPopover();
  render();
}

function lineAtPoint(file, worldPoint) {
  return lineAtWorldPoint(file, worldPoint);
}

function lineRatioAtPoint(file, worldPoint) {
  return lineRatioForLine(file, lineAtPoint(file, worldPoint));
}

function lineRatioForLine(file, line) {
  return (line - 0.5) / Math.max(1, file.lineCount);
}

function sourcePanelLineRange(file, focusLine, box) {
  return sourcePanelLineRangeForBox(file, focusLine, box, canvas.clientHeight);
}

async function searchMap(event) {
  event.preventDefault();
  const query = controls.searchInput?.value;
  if (!String(query ?? "").trim()) return;
  const match = mapSearchMatch(state.map, state.namedPlaces, query);
  const action = mapSearchAction(match);
  await MAP_SEARCH_ACTION_HANDLERS[action.type]?.(match);
}

function setSearchResult(message) {
  if (controls.searchResult) controls.searchResult.textContent = message;
}

function setText(element, value) {
  if (element) element.textContent = value;
}

function applySourcePanel(panel) {
  setText(controls.sourceTitle, panel.sourceTitle);
  setText(controls.sourceOutput, panel.sourceOutput);
  if (Number.isFinite(panel.scrollTop) && controls.sourceOutput) controls.sourceOutput.scrollTop = panel.scrollTop;
}

function parseLineRange(value) {
  if (!value) return null;
  const match = value.match(/^(\d+)(?:-(\d+))?$/);
  if (!match) return null;
  return {
    start: Number(match[1]),
    end: Number(match[2] ?? match[1]),
  };
}

async function previewSelection({ routeToken = null } = {}) {
  const draftSelection = state.draftSelection;
  if (!draftSelection) return;
  const body = {
    level: DEFAULT_MAP_LEVEL,
    geometry: draftSelection,
  };
  const resolvedSelection = await postJson("/api/selections/resolve", body);
  if (routeToken && !isCurrentRoute(routeToken)) return;
  if (state.draftSelection !== draftSelection) return;
  state.resolvedSelection = resolvedSelection;
  syncHashRoute(createSelectionHashRoute({ level: DEFAULT_MAP_LEVEL, bounds: resolvedSelection.geometry.bounds }));
  if (controls.saveSelection) controls.saveSelection.disabled = false;
  setSaveButtonLabel();
  updateSelectionPopover();
  focusSelectionComment();
  setSelectionStatus("Selection ready. Add a comment, then save or press Command Enter on macOS or Control Enter on Linux.");
  render();
}

async function saveSelection() {
  if (state.selectedTarget?.targetType === "annotation" && !state.resolvedSelection) {
    await copySelectedAnnotationPrompt();
    return;
  }
  if (!state.resolvedSelection) return;
  const comment = controls.selectionComment?.value.trim() ?? "";
  if (controls.saveSelection) controls.saveSelection.disabled = true;
  setSelectionStatus("Saving annotation…");
  const saved = await postJson("/api/annotations", {
    comment,
    level: DEFAULT_MAP_LEVEL,
    geometry: state.resolvedSelection.geometry,
  });
  state.namedPlaces.push(saved.annotation);
  const copied = await copyToClipboard(annotationClipboardText(saved.annotation, {
    origin: window.location.origin,
    href: window.location.href,
  }));
  state.selectedTarget = { ...saved.annotation, targetType: "annotation" };
  syncHashRoute(createAnnotationHashRoute(saved.annotation.id));
  state.drawing = false;
  state.panning = false;
  state.draftSelection = null;
  state.resolvedSelection = null;
  updateInteractionModeUi();
  updateSelectionPopover();
  setSaveButtonLabel(copied ? "Codex prompt copied" : "Saved. Copy failed");
  setSelectionStatus(copied ? "Annotation saved and Codex prompt copied." : "Annotation saved. Copy failed.");
  render();
}

function clearAnnotationForm() {
  if (state.draftSelection || state.resolvedSelection) return;
  if (controls.selectionComment) controls.selectionComment.value = "";
  if (controls.saveSelection) controls.saveSelection.disabled = true;
  if (controls.deleteAnnotation) controls.deleteAnnotation.hidden = true;
  setSaveButtonLabel();
  updateSelectionPopover();
}

async function deleteSelectedAnnotation() {
  const annotation = state.selectedTarget?.targetType === "annotation" ? state.selectedTarget : null;
  if (!annotation) return;
  if (!confirm("Delete this annotation?")) return;
  if (controls.deleteAnnotation) controls.deleteAnnotation.disabled = true;
  setSelectionStatus("Deleting annotation…");
  await deleteJson(`/api/annotations/${encodeURIComponent(annotation.id)}`);
  state.namedPlaces = state.namedPlaces.filter((place) => place.id !== annotation.id);
  state.selectedTarget = null;
  state.draftSelection = null;
  state.resolvedSelection = null;
  if (controls.selectionComment) controls.selectionComment.value = "";
  if (window.location.hash === createAnnotationHashRoute(annotation.id)) {
    window.history.replaceState(null, "", "#");
  }
  if (controls.deleteAnnotation) {
    controls.deleteAnnotation.disabled = false;
    controls.deleteAnnotation.hidden = true;
  }
  setSaveButtonLabel();
  setSelectionStatus("Annotation deleted.");
  updateSelectionPopover();
  render();
}

async function copySelectedAnnotationPrompt() {
  const annotation = state.selectedTarget?.targetType === "annotation" ? state.selectedTarget : null;
  if (!annotation) return false;
  const copied = await copyToClipboard(annotationClipboardText(annotation, {
    origin: window.location.origin,
    href: window.location.href,
  }));
  setSaveButtonLabel(copied ? "Codex prompt copied" : "Copy failed");
  setSelectionStatus(copied ? "Codex prompt copied." : "Copy failed.");
  return copied;
}

function focusSelectionComment() {
  if (!controls.selectionComment || state.lastPointerType === "touch") return;
  controls.selectionComment.focus({ preventScroll: true });
}

function setSelectionStatus(message) {
  if (controls.selectionStatus) controls.selectionStatus.textContent = message;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyToClipboardFallback(text);
  }
}

function copyToClipboardFallback(text) {
  const element = document.createElement("textarea");
  element.value = text;
  element.setAttribute("readonly", "");
  element.style.position = "fixed";
  element.style.left = "-9999px";
  document.body.append(element);
  element.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    element.remove();
  }
}

function setSaveButtonLabel(label = SAVE_AND_COPY_LABEL) {
  if (controls.saveSelection) controls.saveSelection.textContent = label;
}

async function addActivity(event) {
  event.preventDefault();
  if (!controls.activityForm) return;
  const data = Object.fromEntries(new FormData(controls.activityForm).entries());
  await postJson("/api/activity", {
    agentId: data.agentId,
    activityState: data.activityState,
    path: data.path,
    lineStart: Number(data.lineStart),
    lineEnd: Number(data.lineEnd),
  });
  setTimeout(refreshActivity, 250);
}

async function clearActivityHistory() {
  if (controls.clearActivityTool) controls.clearActivityTool.disabled = true;
  try {
    await deleteJson("/api/activity");
    state.activity = [];
    state.activitySignature = activitySignature(state.activity);
    if (state.selectedTarget?.targetType === "activity") state.selectedTarget = null;
    setText(controls.hover, "Activity cleared");
    render();
  } finally {
    if (controls.clearActivityTool) controls.clearActivityTool.disabled = false;
  }
}

function hitTest(point) {
  const annotation = hitTestAnnotation(point);
  if (annotation) return annotation;
  const activity = hitTestActivity(point);
  if (activity) return activity;
  return hitTestTargets(state.map, point);
}

function hitTestAnnotation(point) {
  const radiusX = 15 / (canvas.clientWidth * state.view.scale);
  const radiusY = 15 / (canvas.clientHeight * state.view.scale);
  const annotations = state.namedPlaces
    .filter((place) => place.kind === "mapAnnotation")
    .reverse();
  const annotation = annotations.find((place) => {
    if (containsBoundsPoint(place.geometry.bounds, point)) return true;
    const center = boundsCenter(place.geometry.bounds);
    return Math.abs(point.x - center.x) <= radiusX && Math.abs(point.y - center.y) <= radiusY;
  });
  return annotation ? { ...annotation, targetType: "annotation" } : null;
}

function hitTestActivity(point) {
  if (!layerEnabled("showActivity")) return null;
  const radiusX = 13 / (canvas.clientWidth * state.view.scale);
  const radiusY = 13 / (canvas.clientHeight * state.view.scale);
  const events = [...sortedActivityEvents(state.activity)].reverse();
  const event = events.find((candidate) => {
    return activityFragmentBounds(candidate).some((bounds) => {
      const center = boundsCenter(bounds);
      return Math.abs(point.x - center.x) <= radiusX && Math.abs(point.y - center.y) <= radiusY;
    });
  });
  return event ? { ...event, targetType: "activity" } : null;
}

function zoomToBounds(bounds, paddingFactor = 1.2) {
  animateViewTo(viewForBounds(bounds, viewportSize(), paddingFactor));
}

function zoomToReadableFile(file, lineRatio = 0.5) {
  const view = viewForReadableFile(file, viewportSize(), lineRatio);
  animateViewTo(view);
  return view;
}

function fitCodebaseView({ animate = false } = {}) {
  const bounds = state.map?.folders?.[""]?.bounds ?? state.map?.codePlane?.bounds ?? { x: 0, y: 0, width: 1, height: 1 };
  const view = viewForBounds(bounds, viewportSize(), 1.02);
  if (animate) animateViewTo(view);
  else setViewImmediate(view);
}

function setViewImmediate(view) {
  cancelCameraAnimation();
  state.view = view;
  render();
}

function animateViewTo(targetView) {
  cancelCameraAnimation();
  if (reducedMotion.matches) {
    setViewImmediate(targetView);
    return;
  }

  const fromView = { ...state.view };
  const startedAt = performance.now();
  state.cameraAnimation = { frame: 0 };

  const step = (now) => {
    if (!state.cameraAnimation) return;
    const progress = Math.min(1, (now - startedAt) / CAMERA_ANIMATION_MS);
    const eased = easeCamera(progress);
    state.view = interpolateView(fromView, targetView, eased);
    render();
    if (progress < 1) {
      state.cameraAnimation.frame = requestAnimationFrame(step);
    } else {
      state.cameraAnimation = null;
      state.view = targetView;
      render();
    }
  };

  state.cameraAnimation.frame = requestAnimationFrame(step);
}

function cancelCameraAnimation() {
  if (!state.cameraAnimation) return;
  cancelAnimationFrame(state.cameraAnimation.frame);
  state.cameraAnimation = null;
}

function interpolateView(fromView, toView, t) {
  return {
    x: fromView.x + (toView.x - fromView.x) * t,
    y: fromView.y + (toView.y - fromView.y) * t,
    scale: fromView.scale + (toView.scale - fromView.scale) * t,
  };
}

function easeCamera(t) {
  return 1 - (1 - t) ** 3;
}

function activityPathLabel(event) {
  const path = pathFromActivity(event);
  const lines = event.address.lineRange ? `:${event.address.lineRange.start}-${event.address.lineRange.end}` : "";
  const columns = event.address.tokenRange ? `@${event.address.tokenRange.start}-${event.address.tokenRange.end}` : "";
  return `${path || event.address.deepLink}${lines}${columns}`;
}

function pathFromActivity(event) {
  const deepLink = event.address?.deepLink;
  if (!deepLink) return "";
  try {
    return new URL(deepLink).searchParams.get("path") ?? "";
  } catch {
    return "";
  }
}

function worldToScreen(point) {
  return worldToScreenPoint(point, state.view, viewportSize());
}

function screenToWorld(point) {
  return screenToWorldPoint(point, state.view, viewportSize());
}

function screenBounds(bounds) {
  return screenBoundsForView(bounds, state.view, viewportSize());
}

function screenPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: clamp(event.clientX - rect.left, 0, rect.width),
    y: clamp(event.clientY - rect.top, 0, rect.height),
  };
}

function visible(box) {
  return isScreenBoxVisible(box, viewportSize());
}

function screenIntersection(box) {
  const x1 = Math.max(0, box.x);
  const y1 = Math.max(0, box.y);
  const x2 = Math.min(canvas.clientWidth, box.x + box.width);
  const y2 = Math.min(canvas.clientHeight, box.y + box.height);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function boundsCenter(bounds) {
  return modelBoundsCenter(bounds);
}

function viewportSize() {
  return { width: canvas.clientWidth, height: canvas.clientHeight };
}

function viewportCenter() {
  return { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function deleteJson(url) {
  const response = await fetch(url, { method: "DELETE" });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
