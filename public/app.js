import {
  SOURCE_TEXT_MAX_LINES_PER_FRAME,
  SOURCE_TEXT_PREFETCH_LINES,
  activityFragmentBounds,
  activityFeedEvents,
  activityPrimaryBounds,
  activityStateStyle,
  activityTrailGroups,
  activityTrailPointGroups,
  activityTissueBox,
  activityVisualEncoding,
  activityActorKey,
  activityActorLabel,
  annotationClipboardText,
  buildActivityFogState,
  boundsCenter as modelBoundsCenter,
  cachedSourceRange,
  canvasKeyboardAction,
  canRenderSourceText,
  documentKeyboardAction,
  discoveryFogRevealStyle,
  discoveryFogVeilStyle,
  doubleClickMapAction,
  draftSelectionFromDrag,
  fileLabelPriority,
  fileVisualState,
  fogStateForFile,
  fogStateForFolder,
  folderDepth,
  folderDisplayName,
  folderLabelPriority,
  folderStyle,
  hashString,
  hashRouteFocusIntent,
  hitTestActivityEvents,
  hitTestAnnotations,
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
  organicRegionFolders,
  organicRegionPoints,
  organicRegionStyle,
  panViewForDrag,
  panViewByScreenDelta,
  reconciledSelectedTarget,
  screenBoundsForView,
  screenToWorldPoint,
  shouldDrawFolder,
  shouldDrawOrganicRegion,
  shouldLabelFoggedFile,
  shouldLabelFolder,
  shouldShowFogLabel,
  shouldShowFogSourceText,
  rememberSourceRange,
  sourceContextRequest,
  sourcePanelLineRangeForBox,
  sourcePanelState,
  sourceRangeCacheKey,
  sourceTextLayoutForBox,
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
const fogMaskCanvas = document.createElement("canvas");
const fogMaskCtx = fogMaskCanvas.getContext("2d");
const fogLayerCanvas = document.createElement("canvas");
const fogLayerCtx = fogLayerCanvas.getContext("2d");
const mapArea = document.querySelector(".map-area");
const DEFAULT_MAP_LEVEL = "file";
const SAVE_AND_COPY_LABEL = "Save and copy Codex prompt";
const COPY_PROMPT_LABEL = "Copy Codex prompt";
const DELETE_ANNOTATION_LABEL = "Delete";
const CONFIRM_DELETE_ANNOTATION_LABEL = "Confirm Delete";
const CAMERA_ANIMATION_MS = 280;
const DOUBLE_CLICK_ZOOM_FACTOR = 2;
const CLICK_SELECT_DELAY_MS = 220;
const CLEAR_ACTIVITY_HOLD_MS = 1600;
const DELETE_ANNOTATION_CONFIRM_MS = 4000;
const FOG_MASK_SCALE = 0.5;
const POLLING_ERROR_NOTICE_THRESHOLD = 2;

function createPollingTask() {
  let timer = null;
  return {
    start(callback, intervalMs) {
      this.stop();
      timer = setInterval(callback, intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

function createMapApplicationState() {
  const sourceCache = new Map();
  const pendingSourceRequests = new Set();
  return {
    map: null,
    mapFolders: [],
    mapFiles: [],
    organicRegionFolders: [],
    mapVersion: "",
    namedPlaces: [],
    namedPlacesById: new Map(),
    namedPlaceIndexesById: new Map(),
    overlaps: [],
    activity: [],
    activityFog: null,
    sourceCache,
    pendingSourceRequests,
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
    clearSourceState() {
      sourceCache.clear();
      pendingSourceRequests.clear();
    },
  };
}

function createMapControls(root = document) {
  const controlSelectors = [
    ["summary", "#mapSummary"],
    ["hover", "#hoverReadout"],
    ["viewport", "#viewportReadout"],
    ["selectionPopover", "#selectionPopover"],
    ["annotationActions", "#annotationActions"],
    ["inspectorTitle", "#inspectorTitle"],
    ["inspectorSubtitle", "#inspectorSubtitle"],
    ["searchForm", "#searchForm"],
    ["searchInput", "#searchInput"],
    ["searchResult", "#searchResult"],
    ["selectTool", "#selectTool"],
    ["panTool", "#panTool"],
    ["zoomInTool", "#zoomInTool"],
    ["zoomOutTool", "#zoomOutTool"],
    ["resetViewTool", "#resetViewTool"],
    ["drawTool", "#drawTool"],
    ["clearActivityTool", "#clearActivityTool"],
    ["saveSelection", "#saveSelection"],
    ["deleteAnnotation", "#deleteAnnotation"],
    ["copyAnnotationPrompt", "#copyAnnotationPrompt"],
    ["deleteAnnotationAction", "#deleteAnnotationAction"],
    ["selectionComment", "#selectionComment"],
    ["selectionStatus", "#selectionStatus"],
    ["sourceTitle", "#sourceTitle"],
    ["sourceOutput", "#sourceOutput"],
    ["showFolders", "#showFolders"],
    ["showOrganicRegions", "#showOrganicRegions"],
    ["showFiles", "#showFiles"],
    ["showNames", "#showNames"],
    ["showActivity", "#showActivity"],
    ["showGrid", "#showGrid"],
    ["activityFeed", "#activityFeed"],
    ["activityForm", "#activityForm"],
  ];
  const controls = {};
  for (const [name, selector] of controlSelectors) {
    controls[name] = root.querySelector(selector);
  }

  return {
    ...controls,
    layerToggles: () => {
      const toggles = [];
      for (const control of [
        controls.showFolders,
        controls.showOrganicRegions,
        controls.showFiles,
        controls.showNames,
        controls.showActivity,
        controls.showGrid,
      ]) {
        if (control) toggles.push(control);
      }
      return toggles;
    },
  };
}

let frameLabels = [];
let applyingRoute = false;
let routeSequence = 0;
let clearActivityHold = null;
let pendingAnnotationDelete = null;
const pollingErrors = new Map();
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const state = createMapApplicationState();
const controls = createMapControls();
const activityPolling = createPollingTask();
const mapPolling = createPollingTask();

async function boot() {
  const [map, mapVersion, names, activity] = await Promise.all([
    fetchJson("/api/map"),
    fetchJson("/api/map-version"),
    fetchJson("/api/named-places"),
    fetchJson("/api/activity"),
  ]);
  applyMap(map, mapVersion.version);
  setNamedPlaces(names.places);
  state.overlaps = names.overlaps ?? [];
  state.activity = activity.events;
  state.activitySignature = activitySignature(state.activity);
  rebuildActivityFog();
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
  state.mapFolders = objectValues(map.folders);
  state.mapFiles = objectValues(map.files);
  state.organicRegionFolders = organicRegionFolders(map);
  state.mapVersion = version ?? state.mapVersion;
  state.clearSourceState();
  rebuildActivityFog();
  if (controls.summary) {
    controls.summary.textContent = `${state.mapFiles.length} files, ${state.mapFolders.length} folders`;
  }
  reconcileSelectedTarget(previousSelection);
}

function reconcileSelectedTarget(target) {
  state.selectedTarget = reconciledSelectedTarget(state.map, target);
}

function rebuildActivityFog() {
  state.activityFog = buildActivityFogState(state.map, state.activity);
}

function objectValues(value) {
  const values = [];
  for (const key in value) {
    if (Object.hasOwn(value, key)) values.push(value[key]);
  }
  return values;
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

  for (const control of controls.layerToggles()) {
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
  document.querySelector(".map-action-menu")?.addEventListener("toggle", updateActionMenuExpanded);
  bindClearActivityHold();

  mapArea.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerUp);
  canvas.addEventListener("lostpointercapture", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  canvas.addEventListener("dblclick", onCanvasDoubleClick);
  canvas.addEventListener("blur", () => canvas.classList.remove("pointer-focused"));
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "application");
  canvas.setAttribute("aria-label", "CodeCharter map canvas. Use the pointer tool to select items, the hand tool or Space drag to pan, arrow keys to pan, plus and minus to zoom, double click to zoom in, 0 to fit the codebase, Enter to select the center, and Escape to cancel the current action.");
  canvas.addEventListener("keydown", onCanvasKeyDown);
  updateActionMenuExpanded();
  updateInteractionModeUi();
}

function startActivityPolling() {
  activityPolling.start(refreshActivity, 1800);
}

function startMapPolling() {
  mapPolling.start(refreshMap, 1800);
}

async function refreshMap() {
  try {
    const mapVersion = await fetchJson("/api/map-version");
    clearPollingError("map");
    if (!mapVersion.version || mapVersion.version === state.mapVersion) return;
    const [map, names] = await Promise.all([
      fetchJson("/api/map"),
      fetchJson("/api/named-places"),
    ]);
    applyMap(map, mapVersion.version);
    setNamedPlaces(names.places);
    state.overlaps = names.overlaps ?? [];
    render();
  } catch (error) {
    reportPollingError("map", error);
  }
}

async function refreshActivity() {
  try {
    const activity = await fetchJson("/api/activity");
    clearPollingError("activity");
    const nextSignature = activitySignature(activity.events ?? []);
    if (nextSignature === state.activitySignature) {
      if ((activity.events ?? []).length) {
        rebuildActivityFog();
        render();
      }
      return;
    }
    state.activity = activity.events ?? [];
    state.activitySignature = nextSignature;
    rebuildActivityFog();
    render();
  } catch (error) {
    reportPollingError("activity", error);
  }
}

function reportPollingError(key, error) {
  const failure = pollingErrors.get(key) ?? { count: 0, lastLoggedAt: 0 };
  failure.count += 1;
  const now = Date.now();
  if (failure.count === POLLING_ERROR_NOTICE_THRESHOLD) {
    setText(controls.hover, "Reconnecting...");
  }
  if (failure.count === 1 || now - failure.lastLoggedAt > 15000) {
    console.warn(error);
    failure.lastLoggedAt = now;
  }
  pollingErrors.set(key, failure);
}

function clearPollingError(key) {
  if (!pollingErrors.has(key)) return;
  pollingErrors.delete(key);
  if (pollingErrors.size === 0) setText(controls.hover, "Reconnected");
}

function activitySignature(events) {
  const latest = events.at(-1);
  return `${events.length}:${latest?.id ?? ""}:${latest?.timestamp ?? ""}`;
}

function commandDispatcher(commands) {
  const commandsByType = new Map(commands);
  return {
    has: (type) => commandsByType.has(type),
    execute: async (type, ...args) => commandsByType.get(type)?.(...args),
  };
}

const HASH_ROUTE_FOCUS_COMMANDS = commandDispatcher([
  ["annotation", (intent, routeToken) => focusAnnotationRoute(intent.id, routeToken)],
  ["selection", (intent, routeToken) => focusSelectionRoute(intent.params, routeToken)],
  ["map", (intent, routeToken) => focusMapRoute(intent.route, routeToken)],
]);

const MAP_ROUTE_FOCUS_COMMANDS = commandDispatcher([
  ["focusFile", (target, route, routeToken) => showFileForRoute(target, route.params, routeToken)],
  ["focusFolder", (target) => {
    clearAnnotationForm();
    setText(controls.inspectorTitle, folderDisplayName(target));
    setText(controls.inspectorSubtitle, `folder: ${target.path || "."} | ${target.geo.geohash}`);
    render();
  }],
]);

const DOUBLE_CLICK_ACTION_COMMANDS = commandDispatcher([
  ["focusAnnotation", (hit) => {
    zoomToBounds(hit.geometry.bounds, 1.28);
    selectAnnotation(hit);
  }],
  ["selectFolder", (hit, world) => {
    void selectMapTarget(world);
    zoomToBounds(hit.bounds, 1.35);
  }],
  ["selectFile", (hit, world) => {
    void inspectFileTarget(hit, world, { zoomReadable: true });
  }],
  ["selectActivity", (hit) => {
    void selectActivityEvent(hit, { zoomReadable: true });
  }],
]);

const MAP_TARGET_SELECTION_COMMANDS = commandDispatcher([
  ["clearSelection", clearMapSelection],
  ["focusAnnotation", (hit) => {
    zoomToBounds(hit.geometry.bounds, 1.35);
    selectAnnotation(hit);
  }],
  ["selectActivity", selectActivityEvent],
  ["inspectFolder", inspectFolderTarget],
  ["inspectFile", inspectFileTarget],
]);

const MAP_SEARCH_ACTION_COMMANDS = commandDispatcher([
  ["noMatch", () => {
    setSearchResult("No matching place found.");
  }],
  ["focusPlace", (match) => {
    zoomToBounds(match.place.geometry.bounds, 1.35);
    setSearchResult(match.label);
    state.selectedTarget = match.target;
    if (state.selectedTarget?.targetType === "annotation") selectAnnotation(state.selectedTarget);
    render();
  }],
  ["focusFile", async (match) => {
    zoomToReadableFile(match.file);
    await selectMapTarget(boundsCenter(match.file.bounds));
    setSearchResult(match.label);
  }],
  ["focusFolder", (match) => {
    zoomToBounds(match.folder.bounds, 1.6);
    state.selectedTarget = { ...match.folder, targetType: "folder" };
    setText(controls.inspectorTitle, folderDisplayName(match.folder));
    setText(controls.inspectorSubtitle, `folder: ${match.folder.path || "."} | ${match.folder.geo.geohash}`);
    setSearchResult(match.label);
    render();
  }],
]);

const CANVAS_KEYBOARD_COMMANDS = commandDispatcher([
  ["pan", (action) => {
    animateViewTo(panViewByScreenDelta(state.view, action.delta, viewportSize()));
  }],
  ["zoomIn", () => {
    zoomAt(viewportCenter(), KEYBOARD_ZOOM_FACTOR, { animate: true });
  }],
  ["zoomOut", () => {
    zoomAt(viewportCenter(), 1 / KEYBOARD_ZOOM_FACTOR, { animate: true });
  }],
  ["fitCodebase", () => {
    fitCodebaseView({ animate: true });
  }],
  ["selectCenter", () => selectMapTarget(screenToWorld(viewportCenter()))],
]);

const DOCUMENT_KEYBOARD_COMMANDS = commandDispatcher([
  ["startSpacePan", () => {
    setSpacePanMode(true);
  }],
  ["cancelInteraction", cancelCurrentInteraction],
  ["saveSelection", saveSelection],
  ["copyAnnotationPrompt", copySelectedAnnotationPrompt],
  ["deleteAnnotation", deleteSelectedAnnotation],
]);

await boot();

async function applyHashRoute() {
  const routeToken = ++routeSequence;
  const route = parseHashRoute(window.location.hash);
  const intent = hashRouteFocusIntent(route, { hasMap: Boolean(state.map) });
  if (!intent) return;

  applyingRoute = true;
  try {
    await HASH_ROUTE_FOCUS_COMMANDS.execute(intent.type, intent, routeToken);
  } finally {
    if (routeToken === routeSequence) applyingRoute = false;
  }
}

async function focusAnnotationRoute(id, routeToken) {
  let annotation = state.namedPlacesById.get(id);
  if (annotation?.kind !== "mapAnnotation") annotation = null;
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
  updateSelectionPopover();
  setSelectionStatus("Resolving selection...");
  zoomToBounds(bounds, 1.35);
  await previewSelection({ routeToken });
}

async function focusMapRoute(route, routeToken) {
  const target = mapRouteTarget(state.map, route);
  const action = mapRouteFocusAction(target);
  if (!action) return;

  resetSelectionOverlay();
  const routeLineRange = target.targetType === "file" ? parseLineRange(route.params.get("lines")) : null;
  if (routeLineRange) {
    zoomToReadableFile(target, lineRatioForLine(target, routeLineRange.start));
  } else {
    zoomToBounds(target.bounds, action.zoomPadding);
  }
  state.selectedTarget = target;
  await MAP_ROUTE_FOCUS_COMMANDS.execute(action.type, target, route, routeToken);
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

function updateActionMenuExpanded() {
  const menu = document.querySelector(".map-action-menu");
  const trigger = menu?.querySelector(".menu-trigger");
  trigger?.setAttribute("aria-expanded", String(Boolean(menu?.open)));
}

function clearDraftSelection() {
  clearPendingAnnotationDelete();
  state.dragging = null;
  state.draftSelection = null;
  state.resolvedSelection = null;
  if (controls.saveSelection) controls.saveSelection.disabled = true;
  setSaveButtonLabel();
  updateSelectionPopover();
}

function resetSelectionOverlay() {
  clearPendingAnnotationDelete();
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

function setNamedPlaces(places) {
  state.namedPlaces = places;
  state.namedPlacesById = new Map();
  state.namedPlaceIndexesById = new Map();
  for (let index = 0; index < places.length; index += 1) {
    const place = places[index];
    if (!place?.id) continue;
    state.namedPlacesById.set(place.id, place);
    state.namedPlaceIndexesById.set(place.id, index);
  }
}

function upsertNamedPlace(place) {
  const index = state.namedPlaceIndexesById.get(place.id);
  if (index === undefined) {
    state.namedPlaces.push(place);
    if (place?.id) state.namedPlaceIndexesById.set(place.id, state.namedPlaces.length - 1);
  } else {
    state.namedPlaces[index] = place;
  }
  if (place?.id) state.namedPlacesById.set(place.id, place);
}

function updateSelectionPopover() {
  const selectedAnnotation = state.selectedTarget?.targetType === "annotation";
  const hasDraft = Boolean(state.draftSelection || state.resolvedSelection);
  const selectionReady = Boolean(state.resolvedSelection);
  if (controls.selectionPopover) controls.selectionPopover.hidden = !hasDraft;
  if (controls.annotationActions) controls.annotationActions.hidden = !selectedAnnotation || hasDraft;
  if (controls.deleteAnnotation) controls.deleteAnnotation.hidden = !selectedAnnotation;
  if (controls.saveSelection) {
    controls.saveSelection.disabled = !(selectionReady || selectedAnnotation);
    setSaveButtonLabel(selectedAnnotation ? COPY_PROMPT_LABEL : selectionReady ? SAVE_AND_COPY_LABEL : "Resolving selection...");
  }
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  fogMaskCanvas.width = Math.max(1, Math.floor(canvas.width * FOG_MASK_SCALE));
  fogMaskCanvas.height = Math.max(1, Math.floor(canvas.height * FOG_MASK_SCALE));
  fogMaskCtx.setTransform(dpr * FOG_MASK_SCALE, 0, 0, dpr * FOG_MASK_SCALE, 0, 0);
  fogLayerCanvas.width = canvas.width;
  fogLayerCanvas.height = canvas.height;
  fogLayerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
  if (activityDiscoveryEnabled()) drawDiscoveryFogOverlay(rect);
  if (activityDiscoveryEnabled()) drawActivity();
  renderActivityFeed();
}

function bindClearActivityHold() {
  const control = controls.clearActivityTool;
  if (!control) return;
  control.addEventListener("pointerdown", onClearActivityPointerDown);
  control.addEventListener("pointerup", cancelClearActivityHold);
  control.addEventListener("pointerleave", cancelClearActivityHold);
  control.addEventListener("pointercancel", cancelClearActivityHold);
  control.addEventListener("lostpointercapture", cancelClearActivityHold);
  control.addEventListener("keydown", onClearActivityKeyDown);
  control.addEventListener("keyup", onClearActivityKeyUp);
  control.addEventListener("click", (event) => event.preventDefault());
}

function onClearActivityPointerDown(event) {
  if (event.button !== 0 || controls.clearActivityTool?.disabled) return;
  event.preventDefault();
  controls.clearActivityTool?.setPointerCapture?.(event.pointerId);
  startClearActivityHold();
}

function onClearActivityKeyDown(event) {
  if (event.repeat || controls.clearActivityTool?.disabled) return;
  if (event.key !== " " && event.key !== "Enter") return;
  event.preventDefault();
  startClearActivityHold();
}

function onClearActivityKeyUp(event) {
  if (event.key !== " " && event.key !== "Enter") return;
  cancelClearActivityHold();
}

function startClearActivityHold() {
  cancelClearActivityHold();
  controls.clearActivityTool?.classList.add("is-holding");
  controls.clearActivityTool?.setAttribute("aria-description", "Hold until the progress fill completes to clear activity history.");
  setText(controls.hover, "Hold to clear activity");
  clearActivityHold = setTimeout(() => {
    clearActivityHold = null;
    controls.clearActivityTool?.classList.remove("is-holding");
    controls.clearActivityTool?.removeAttribute("aria-description");
    void clearActivityHistory();
  }, CLEAR_ACTIVITY_HOLD_MS);
}

function cancelClearActivityHold() {
  if (!clearActivityHold) return;
  clearTimeout(clearActivityHold);
  clearActivityHold = null;
  controls.clearActivityTool?.classList.remove("is-holding");
  controls.clearActivityTool?.removeAttribute("aria-description");
  setText(controls.hover, "Clear cancelled");
}

function layerEnabled(name, fallback = true) {
  return controls[name]?.checked ?? fallback;
}

function activityDiscoveryEnabled() {
  return controls.showActivity?.checked === true;
}

function drawDiscoveryFogOverlay(rect) {
  buildDiscoveryFogMask(rect);

  fogLayerCtx.save();
  fogLayerCtx.clearRect(0, 0, rect.width, rect.height);
  drawDiscoveryVeil(rect, fogLayerCtx);

  fogLayerCtx.globalCompositeOperation = "destination-out";
  fogLayerCtx.drawImage(fogMaskCanvas, 0, 0, rect.width, rect.height);
  fogLayerCtx.restore();

  ctx.save();
  ctx.drawImage(fogLayerCanvas, 0, 0, rect.width, rect.height);
  ctx.restore();
}

function drawDiscoveryVeil(rect, targetCtx = ctx) {
  const style = discoveryFogVeilStyle();
  const gradient = targetCtx.createLinearGradient(0, 0, rect.width, rect.height);
  gradient.addColorStop(0, `rgba(1, 7, 11, ${style.baseAlpha})`);
  gradient.addColorStop(0.54, `rgba(3, 16, 14, ${style.baseAlpha * 0.96})`);
  gradient.addColorStop(1, `rgba(8, 13, 20, ${style.horizonAlpha})`);
  targetCtx.fillStyle = gradient;
  targetCtx.fillRect(0, 0, rect.width, rect.height);

  drawDiscoveryVeilTexture(rect, style, targetCtx);

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

function drawDiscoveryVeilTexture(rect, style, targetCtx = ctx) {
  const step = style.textureStep;
  targetCtx.save();
  targetCtx.fillStyle = `rgba(190, 244, 216, ${style.textureAlpha})`;
  for (let y = -step; y < rect.height + step; y += step) {
    const row = Math.floor(y / step);
    for (let x = -step; x < rect.width + step; x += step) {
      const column = Math.floor(x / step);
      const unit = integerNoise(column, row);
      if (unit < 0.52) continue;
      const size = 1 + unit * 1.8;
      const offsetX = (integerNoise(column + 19, row - 7) - 0.5) * step * 0.44;
      const offsetY = (integerNoise(column - 11, row + 23) - 0.5) * step * 0.44;
      targetCtx.globalAlpha = style.textureAlpha * (0.35 + unit * 0.75);
      targetCtx.fillRect(x + offsetX, y + offsetY, size, size);
    }
  }
  targetCtx.restore();
}

function buildDiscoveryFogMask(rect) {
  fogMaskCtx.save();
  fogMaskCtx.setTransform(
    (window.devicePixelRatio || 1) * FOG_MASK_SCALE,
    0,
    0,
    (window.devicePixelRatio || 1) * FOG_MASK_SCALE,
    0,
    0,
  );
  fogMaskCtx.clearRect(0, 0, rect.width, rect.height);
  fogMaskCtx.globalCompositeOperation = "source-over";
  drawDiscoveryTrailMask(fogMaskCtx);
  drawDiscoveryFogReveals(fogMaskCtx);
  fogMaskCtx.restore();
}

function drawDiscoveryFogReveals(targetCtx) {
  const fog = state.activityFog;
  if (!fog) return;
  for (const path of fog.visitedFiles) {
    const file = state.map.files[path];
    if (!file) continue;
    const box = screenBounds(file.bounds);
    const visibleFile = fog.visibleFiles.has(path);
    const readable = state.view.scale > 2 && canRenderSourceText(file, box);
    const revealStyle = discoveryFogRevealStyle({ visibleFile, readable });
    if (!visible(expandedBox(box, revealStyle.padding + 14))) continue;
    if (readable) {
      drawReadableFogReveal(box, revealStyle, targetCtx);
    } else {
      drawFogReveal(path, box, revealStyle, targetCtx);
    }
  }
}

function drawDiscoveryTrailMask(targetCtx) {
  const events = sortedActivityEvents(state.activity);
  if (events.length < 2) return;
  targetCtx.save();
  targetCtx.lineCap = "round";
  targetCtx.lineJoin = "round";
  targetCtx.filter = "blur(14px)";
  for (const agentEvents of activityTrailGroups(events)) {
    for (const points of activityTrailPointGroups(activityTrailPoints(agentEvents))) {
      strokeFogTrail(targetCtx, points, { alpha: 0.12, lineWidth: 88 });
    }
  }
  targetCtx.filter = "none";
  for (const agentEvents of activityTrailGroups(events)) {
    for (const points of activityTrailPointGroups(activityTrailPoints(agentEvents))) {
      strokeFogTrail(targetCtx, points, { alpha: 0.1, lineWidth: 42 });
    }
  }
  targetCtx.restore();
}

function strokeFogTrail(targetCtx, points, { alpha, lineWidth }) {
  targetCtx.strokeStyle = `rgba(0, 0, 0, ${alpha})`;
  targetCtx.lineWidth = lineWidth;
  targetCtx.beginPath();
  if (drawMyceliumPathForContext(targetCtx, points)) targetCtx.stroke();
}

function drawReadableFogReveal(box, { alpha, padding }, targetCtx = ctx) {
  const x = Math.max(0, box.x - padding);
  const y = Math.max(0, box.y - padding);
  const right = Math.min(canvas.clientWidth, box.x + box.width + padding);
  const bottom = Math.min(canvas.clientHeight, box.y + box.height + padding);
  if (right <= x || bottom <= y) return;

  targetCtx.save();
  targetCtx.filter = "blur(10px)";
  targetCtx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
  targetCtx.fillRect(x, y, right - x, bottom - y);
  targetCtx.restore();
}

function drawFogReveal(key, box, { alpha, padding, core, mid, lobes = 3 }, targetCtx = ctx) {
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
    drawFogRevealGradient({
      x: centerX + Math.cos(angle) * radiusX * distance,
      y: centerY + Math.sin(angle) * radiusY * distance,
      radiusX: lobeRadiusX,
      radiusY: lobeRadiusY,
      alpha: alpha * 0.28,
      core: 0.2,
      mid: 0.72,
    }, targetCtx);
  }
}

function drawFogRevealGradient({ x, y, radiusX, radiusY, alpha, core, mid }, targetCtx = ctx) {
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

function drawMyceliumPathForContext(targetCtx, points) {
  if (points.length < 2) return false;

  const minDistance = Math.min(14, Math.max(6, state.view.scale * 2.2));
  const segments = organicTrailSegments(points, { minDistance });
  if (segments.length === 0) return false;

  targetCtx.moveTo(segments[0].start.x, segments[0].start.y);
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

function expandedBox(box, padding) {
  return {
    x: box.x - padding,
    y: box.y - padding,
    width: box.width + padding * 2,
    height: box.height + padding * 2,
  };
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
  const fogEnabled = activityDiscoveryEnabled();
  for (const folder of state.mapFolders) {
    if (!folder.path) continue;
    const box = screenBounds(folder.bounds);
    if (!visible(box)) continue;
    const depth = folderDepth(folder.path);
    if (!shouldDrawFolder(state.view.scale, depth, box)) continue;
    const selected = state.selectedTarget?.targetType === "folder" && state.selectedTarget.path === folder.path;
    const fogState = fogEnabled ? fogStateForFolder(state.activityFog, folder, { selected }) : "visible";
    const style = folderStyle(folder.path, depth);
    const fogStyle = folderFogStyle(style, fogState, depth, selected, fogEnabled);
    ctx.fillStyle = fogStyle.fill;
    ctx.strokeStyle = fogStyle.stroke;
    ctx.lineWidth = selected ? 2.6 : fogStyle.lineWidth;
    drawRect(box);
    if (shouldShowFogLabel(fogState, { selected }) && shouldLabelFolder(state.view.scale, depth, box)) {
      queueLabelInBox({
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

function drawOrganicRegions() {
  const fogEnabled = activityDiscoveryEnabled();
  for (const { folder, depth } of state.organicRegionFolders) {
    const box = screenBounds(folder.bounds);
    if (!visible(box)) continue;
    if (!shouldDrawOrganicRegion(state.view.scale, depth, box)) continue;
    const points = organicRegionPoints(folder.bounds, folder.path, depth);
    if (points.length < 3) continue;
    const style = organicRegionStyle(folder.path, depth);
    const selected = state.selectedTarget?.targetType === "folder" && state.selectedTarget.path === folder.path;
    const fogState = fogEnabled ? fogStateForFolder(state.activityFog, folder, { selected }) : "visible";
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

function drawFiles() {
  const fogEnabled = activityDiscoveryEnabled();
  let renderedSourceLines = 0;
  for (const file of state.mapFiles) {
    const box = screenBounds(file.bounds);
    if (!visible(box)) continue;
    const selected = state.selectedTarget?.path === file.path;
    const fogState = fogEnabled ? fogStateForFile(state.activityFog, file, { selected }) : "visible";
    const visualState = fileVisualState({ file, box, scale: state.view.scale, selected });
    if (visualState === "hidden") continue;

    const style = fileFogStyle({ fogState, selected, visualState, discoveryMode: fogEnabled });
    ctx.fillStyle = style.fill;
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = style.lineWidth;
    drawRect(box);
    if (shouldLabelFoggedFile({ file, box, scale: state.view.scale, selected, fogState })) {
      queueLabelInBox({
        text: file.name,
        box,
        color: style.label,
        size: 12,
        weight: "500",
        priority: fileLabelPriority({ file, selected }),
      });
    }
    if (
      shouldShowFogSourceText(fogState, { selected })
      && canRenderSourceText(file, box)
      && renderedSourceLines < SOURCE_TEXT_MAX_LINES_PER_FRAME
    ) {
      renderedSourceLines += drawSourceText(file, box, SOURCE_TEXT_MAX_LINES_PER_FRAME - renderedSourceLines);
    } else if (shouldShowFogSourceText(fogState, { selected }) && state.view.scale > 6 && box.height > 34) {
      drawLineBands(file, box);
    }
  }
}

function folderFogStyle(style, fogState, depth, selected, discoveryMode = false) {
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

function organicRegionFogStyle(style, fogState, depth, selected, discoveryMode = false) {
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

function fileFogStyle({ fogState, selected, visualState, discoveryMode = false }) {
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
      lineWidth: visualState === "aggregate" ? 0.35 : state.view.scale > 2.2 ? 1 : 0.65,
    };
  }
  if (fogState === "visible") {
    return {
      fill: "rgba(235, 248, 241, 0.48)",
      stroke: visualState === "aggregate" ? "rgba(18, 128, 98, 0.16)" : "rgba(18, 128, 98, 0.34)",
      label: "rgba(3, 87, 67, 0.84)",
      lineWidth: visualState === "aggregate" ? 0.35 : state.view.scale > 2.2 ? 1 : 0.65,
    };
  }
  if (fogState === "explored") {
    return {
      fill: "rgba(42, 70, 57, 0.42)",
      stroke: visualState === "aggregate" ? "rgba(126, 153, 134, 0.18)" : "rgba(126, 153, 134, 0.34)",
      label: "rgba(177, 202, 185, 0.76)",
      lineWidth: visualState === "aggregate" ? 0.35 : state.view.scale > 2.2 ? 0.9 : 0.55,
    };
  }
  return {
    fill: "rgba(0, 0, 0, 0.9)",
    stroke: visualState === "aggregate" ? "rgba(54, 70, 63, 0.12)" : "rgba(69, 91, 80, 0.24)",
    label: "rgba(106, 126, 116, 0.42)",
    lineWidth: visualState === "aggregate" ? 0.25 : 0.5,
  };
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

  const linesByNumber = new Map();
  for (const line of cached.lines) {
    linesByNumber.set(line.number, line.text);
  }
  const lineHeight = lineHeightForFile(file, box);
  const firstBaseline = box.y + (visibleRange.start - 1) * lineHeight + Math.min(13, lineHeight * 0.78);
  const sourceTextLayout = sourceTextLayoutForBox(box, canvas.clientWidth);
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
    ctx.fillText(String(lineNumber).padStart(4, " "), sourceTextLayout.lineNumberX, y);
    ctx.fillStyle = "rgba(12, 34, 48, 0.86)";
    ctx.fillText(truncateLine(text, sourceTextLayout.maxChars), sourceTextLayout.textX, y);
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
  const discoveryMode = activityDiscoveryEnabled();
  drawActivityMembranes(events, latestByAgent, { discoveryMode });
  drawActivityTrails(events, latestByAgent, { discoveryMode });

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
      if (!discoveryMode || latest || selected) {
        drawLabel(label, p.x + 10, p.y - 8, encoding.active ? style.label : "#475569", 12, "700");
      }
    }
    ctx.restore();
  }
}

function drawActivityMembranes(events, latestByAgent, { discoveryMode = false } = {}) {
  for (const event of events) {
    const latest = latestByAgent.get(activityActorKey(event)) === event;
    const selected = state.selectedTarget?.targetType === "activity" && state.selectedTarget.id === event.id;
    const encoding = activityVisualEncoding(event, { latest, selected });
    if (discoveryMode && state.view.scale > 6 && !selected) continue;
    if (discoveryMode && !latest && !selected) continue;
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
      const membraneAlpha = discoveryMode && !selected ? encoding.membraneAlpha * 0.45 : encoding.membraneAlpha;
      gradient.addColorStop(0, hexToRgba(fillColor, membraneAlpha));
      gradient.addColorStop(0.58, hexToRgba(fillColor, membraneAlpha * 0.45));
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

function drawActivityTrails(events, latestByAgent, { discoveryMode = false } = {}) {
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
        color: hexToRgba(fillColor, encoding.trailAlpha * (discoveryMode ? 0.045 : 0.16)),
        lineWidth: encoding.lineWidth * (discoveryMode ? 3.2 : 5.4),
      });
    }
    ctx.shadowBlur = 0;
    for (const points of pointGroups) {
      strokeOrganicTrail(points, {
        color: hexToRgba(fillColor, encoding.trailAlpha * (discoveryMode ? 0.12 : 0.38)),
        lineWidth: encoding.lineWidth * (discoveryMode ? 1.4 : 2.25),
      });
      if (!discoveryMode || selected || latest) {
        strokeOrganicTrail(points, {
          color: hexToRgba(fillColor, Math.min(discoveryMode ? 0.42 : 0.9, encoding.trailAlpha * (discoveryMode ? 0.46 : 0.95))),
          lineWidth: encoding.lineWidth * (discoveryMode ? 0.82 : 1),
        });
      }
    }
    ctx.restore();
  }
}

function activityTrailSelected(events) {
  if (state.selectedTarget?.targetType !== "activity") return false;
  return events.some((event) => event.id === state.selectedTarget.id);
}

function activityTrailPoints(events) {
  const points = [];
  for (const event of events) {
    const bounds = activityPrimaryBounds(event);
    if (bounds) points.push(worldToScreen(boundsCenter(bounds)));
  }
  return points;
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

function integerNoise(x, y) {
  let value = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
}

function renderActivityFeed() {
  if (!controls.activityFeed) return;
  const latest = activityFeedEvents(state.activity);

  controls.activityFeed.replaceChildren();
  if (latest.length === 0) {
    controls.activityFeed.textContent = "No activity yet.";
    return;
  }

  for (const event of latest) {
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
  if (!labelsAreInPriorityOrder(frameLabels)) frameLabels.sort((a, b) => b.priority - a.priority);
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

function labelsAreInPriorityOrder(labels) {
  for (let index = 1; index < labels.length; index += 1) {
    if (labels[index - 1].priority < labels[index].priority) return false;
  }
  return true;
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
  if (!action || !CANVAS_KEYBOARD_COMMANDS.has(action.type)) return;
  event.preventDefault();
  void CANVAS_KEYBOARD_COMMANDS.execute(action.type, action);
}

function onDocumentKeyDown(event) {
  const action = documentKeyboardAction(event, {
    textEntry: isTextEntryTarget(event.target),
    buttonTarget: isButtonTarget(event.target),
    hasResolvedSelection: Boolean(state.resolvedSelection),
    hasSelectedAnnotation: state.selectedTarget?.targetType === "annotation",
  });
  if (!action || !DOCUMENT_KEYBOARD_COMMANDS.has(action.type)) return;
  event.preventDefault();
  void DOCUMENT_KEYBOARD_COMMANDS.execute(action.type, action);
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
    clearSelectionHashRoute();
    setSelectionStatus("Selection cancelled.");
    render();
    canvas.focus({ preventScroll: true });
    return;
  }

  if (state.selectedTarget) {
    state.selectedTarget = null;
    if (controls.selectionComment) controls.selectionComment.value = "";
    updateSelectionPopover();
    clearSelectionHashRoute();
    setSelectionStatus("Selection cleared.");
    render();
    canvas.focus({ preventScroll: true });
  }
}

function clearSelectionHashRoute() {
  if (parseHashRoute(window.location.hash)?.type === "selection") {
    window.history.replaceState(null, "", "#");
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
    if (event && event.type !== "lostpointercapture") updateDraftSelection(screenToWorld(screenPoint(event)));
    if (!hasUsableDraftSelection()) {
      clearDraftSelection();
      render();
      return;
    }
    state.dragging = null;
    updateInteractionModeUi();
    await previewSelection();
    return;
  }

  if (state.dragging?.type === "select" && state.lastPointerDown && event) {
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

function onPointerCancel() {
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
    void DOUBLE_CLICK_ACTION_COMMANDS.execute(action.type, hit, world);
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
  await MAP_TARGET_SELECTION_COMMANDS.execute(action.type, hit, worldPoint);
}

function clearMapSelection() {
  clearPendingAnnotationDelete();
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
  clearPendingAnnotationDelete();
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

async function inspectFileTarget(hit, worldPoint, { zoomReadable = false } = {}) {
  inspectMapTarget(hit);
  const line = lineAtPoint(hit, worldPoint);
  const lineRatio = lineRatioForLine(hit, line);
  let box = screenBounds(hit.bounds);
  if (zoomReadable && !canRenderSourceText(hit, box)) {
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

async function selectActivityEvent(event, { zoomReadable = false } = {}) {
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
  if (zoomReadable) {
    const file = state.map.files[path];
    if (file) zoomToReadableFile(file, lineRatioForLine(file, lineRange.start));
  }
  const sourceContext = sourceContextRequest(path, lineRange);
  const [address, source] = await Promise.all([
    fetchJson(sourceContext.resolveUrl),
    fetchJson(sourceContext.sourceUrl),
  ]);
  syncHashRoute(createMapHashRoute(address.targetType, address.geohash, { path, lines: sourceContext.lines }));
  applySourcePanel(sourcePanelState({ path, deepLink: address.deepLink, source }));
  render();
}

function selectAnnotation(annotation) {
  clearPendingAnnotationDelete();
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
  await MAP_SEARCH_ACTION_COMMANDS.execute(action.type, match);
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
  setSelectionStatus("Selection ready. Add a comment, then save or press Command Enter on macOS or Control Enter elsewhere.");
  render();
}

async function saveSelection() {
  clearPendingAnnotationDelete();
  if (state.selectedTarget?.targetType === "annotation" && !state.resolvedSelection) {
    await copySelectedAnnotationPrompt();
    return;
  }
  if (!state.resolvedSelection) return;
  const comment = controls.selectionComment?.value.trim() ?? "";
  if (controls.saveSelection) controls.saveSelection.disabled = true;
  setSelectionStatus("Saving annotation…");
  const savedPromise = postJson("/api/annotations", {
    comment,
    level: DEFAULT_MAP_LEVEL,
    geometry: state.resolvedSelection.geometry,
  });
  const copiedPromise = copyDeferredToClipboard(savedPromise.then((saved) => annotationClipboardText(saved.annotation, {
    origin: window.location.origin,
    href: window.location.href,
  })));
  const saved = await savedPromise;
  upsertNamedPlace(saved.annotation);
  const copied = await copiedPromise;
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
  clearPendingAnnotationDelete();
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
  if (!isPendingAnnotationDelete(annotation)) {
    armAnnotationDelete(annotation);
    return;
  }
  clearPendingAnnotationDelete();
  setDeleteButtonsDisabled(true);
  setSelectionStatus("Deleting annotation…");
  await deleteJson(`/api/annotations/${encodeURIComponent(annotation.id)}`);
  removeNamedPlace(annotation.id);
  state.selectedTarget = null;
  state.draftSelection = null;
  state.resolvedSelection = null;
  if (controls.selectionComment) controls.selectionComment.value = "";
  if (window.location.hash === createAnnotationHashRoute(annotation.id)) {
    window.history.replaceState(null, "", "#");
  }
  setDeleteButtonsDisabled(false);
  if (controls.deleteAnnotation) controls.deleteAnnotation.hidden = true;
  setSaveButtonLabel();
  setDeleteButtonLabel();
  setSelectionStatus("Annotation deleted.");
  updateSelectionPopover();
  render();
}

function armAnnotationDelete(annotation) {
  clearPendingAnnotationDelete();
  setDeleteButtonLabel(CONFIRM_DELETE_ANNOTATION_LABEL);
  setSelectionStatus("Press Delete again to delete this annotation.");
  pendingAnnotationDelete = {
    id: annotation.id,
    timer: window.setTimeout(() => {
      pendingAnnotationDelete = null;
      setDeleteButtonLabel();
      setSelectionStatus("Delete confirmation expired.");
    }, DELETE_ANNOTATION_CONFIRM_MS),
  };
}

function isPendingAnnotationDelete(annotation) {
  return pendingAnnotationDelete?.id === annotation.id;
}

function clearPendingAnnotationDelete() {
  if (!pendingAnnotationDelete) return;
  window.clearTimeout(pendingAnnotationDelete.timer);
  pendingAnnotationDelete = null;
  setDeleteButtonLabel();
}

function setDeleteButtonLabel(label = DELETE_ANNOTATION_LABEL) {
  if (controls.deleteAnnotation) controls.deleteAnnotation.textContent = label;
  if (controls.deleteAnnotationAction) controls.deleteAnnotationAction.textContent = label;
}

function setDeleteButtonsDisabled(disabled) {
  if (controls.deleteAnnotation) controls.deleteAnnotation.disabled = disabled;
  if (controls.deleteAnnotationAction) controls.deleteAnnotationAction.disabled = disabled;
}

function removeNamedPlace(id) {
  const index = state.namedPlaceIndexesById.get(id);
  if (index === undefined) return;
  state.namedPlaces.splice(index, 1);
  state.namedPlacesById.delete(id);
  state.namedPlaceIndexesById.delete(id);
  for (let nextIndex = index; nextIndex < state.namedPlaces.length; nextIndex += 1) {
    const place = state.namedPlaces[nextIndex];
    if (place?.id) state.namedPlaceIndexesById.set(place.id, nextIndex);
  }
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

async function copyDeferredToClipboard(textPromise) {
  if (navigator.clipboard?.write && window.ClipboardItem && window.Blob) {
    try {
      const item = new ClipboardItem({
        "text/plain": textPromise.then((text) => new Blob([text], { type: "text/plain" })),
      });
      await navigator.clipboard.write([item]);
      return true;
    } catch {
      // Fall through to the legacy path below.
    }
  }

  try {
    return await copyToClipboard(await textPromise);
  } catch {
    return false;
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
  const data = formDataObject(new FormData(controls.activityForm));
  await postJson("/api/activity", {
    agentId: data.agentId,
    activityState: data.activityState,
    path: data.path,
    lineStart: Number(data.lineStart),
    lineEnd: Number(data.lineEnd),
  });
  setTimeout(refreshActivity, 250);
}

function formDataObject(formData) {
  const data = {};
  for (const [key, value] of formData) data[key] = value;
  return data;
}

async function clearActivityHistory() {
  if (controls.clearActivityTool) controls.clearActivityTool.disabled = true;
  try {
    await deleteJson("/api/activity");
    state.activity = [];
    state.activitySignature = activitySignature(state.activity);
    rebuildActivityFog();
    if (state.selectedTarget?.targetType === "activity") state.selectedTarget = null;
    setText(controls.hover, "Activity cleared");
    render();
  } finally {
    if (controls.clearActivityTool) {
      controls.clearActivityTool.disabled = false;
      controls.clearActivityTool.classList.remove("is-holding");
    }
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
  return hitTestAnnotations(state.namedPlaces, point, { radiusX, radiusY });
}

function hitTestActivity(point) {
  if (!activityDiscoveryEnabled()) return null;
  const radiusX = 13 / (canvas.clientWidth * state.view.scale);
  const radiusY = 13 / (canvas.clientHeight * state.view.scale);
  return hitTestActivityEvents(state.activity, point, { radiusX, radiusY });
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
  return requestJson(url);
}

async function deleteJson(url) {
  return requestJson(url, { method: "DELETE" });
}

async function postJson(url, body) {
  return requestJson(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
