/**
 * Viewer application shell: DOM/canvas bootstrap, the render loop, pointer/
 * keyboard wiring, hash-route handling, and the localhost API calls. Two
 * module-scope singletons hold all mutable UI state: `state` (the map view,
 * interaction mode, draft/resolved selection, selected target, editing
 * annotation, activity + fog) and `controls` (resolved DOM elements). Pure,
 * deterministic logic lives in `render/*` (unit-tested) and is consumed here.
 *
 * Decomposition status (modernization Phase 4):
 *   - `controllers/camera.ts`    — wheel/keyboard/double-click zoom + pan +
 *                                  viewport-center (extracted; DI over the view).
 *   - `controllers/selection.ts` — draw → draft → resolve lifecycle (extracted).
 *   - `controllers/editing.ts`   — saveSelection, annotation create/edit/delete/
 *                                  copy, the pending-delete confirmation, and
 *                                  clipboard (extracted; DI over the shared
 *                                  selection/editing state + app-owned UI). The
 *                                  semantic state (selected target, editing
 *                                  annotation, draft/resolved selection) stays
 *                                  here in `state` and is read by the render loop
 *                                  and `updateSelectionPopover`.
 *   - `controllers/interaction.ts` — draw/select/pan/space-pan mode transitions +
 *                                  toolbar UI sync (extracted; DI over the
 *                                  interaction flags in `state` + the toolbar/
 *                                  canvas DOM singletons + app-owned callbacks).
 *   - `controllers/selection-overlay.ts` — selection popover visibility,
 *                                  annotation-actions positioning, overlay reset,
 *                                  draft clearance, and named-places sync
 *                                  (extracted; DI over the draft/resolved/editing
 *                                  state + overlay DOM + app-owned callbacks). It
 *                                  reads the same `state`; it owns no identity.
 *   - `controllers/routing.ts`   — browser hash-route apply/focus/sync: parse the
 *                                  `#…` route, focus the matching annotation/
 *                                  selection/map target, and write stable routes
 *                                  back (extracted; DI over the shared map/named-
 *                                  places state + app-owned callbacks + the
 *                                  editing/selection controllers). The route-
 *                                  sequence token and in-apply latch are private
 *                                  to that factory; the shell still wires
 *                                  hashchange → applyHashRoute.
 *   - `render/fog.ts`            — discovery-fog drawing: the veil/mask/reveal/
 *                                  mycelium orchestration plus the fog colouring
 *                                  helpers (`folderFogStyle`, `fileFogStyle`,
 *                                  …). The shell keeps the canvas singletons and
 *                                  the fog-veil cache key and hands them to
 *                                  `createFogDrawer`; `render()` calls
 *                                  `fogDrawer.drawDiscoveryFogOverlay`.
 *   - `render/activity.ts`       — activity drawing: membranes/cells/trails/
 *                                  tissue markers + the activity feed, plus the
 *                                  pure colour/age helpers (`activityFillColor`,
 *                                  `hexToRgba`, …). The shell injects `ctx`, the
 *                                  projection accessors, `drawLabel`, and the
 *                                  feed-click → `selectActivityEvent` bridge into
 *                                  `createActivityDrawer`; the hex-RGB cache and
 *                                  feed dedup key are private to that factory.
 *                                  `render()` calls `activityDrawer.drawActivity`
 *                                  and `activityDrawer.renderActivityFeed`.
 */

import { createActivityGestureController } from "./controllers/activity-gesture.ts";
import { createCameraController } from "./controllers/camera.ts";
import { createEditingController } from "./controllers/editing.ts";
import { createInteractionController } from "./controllers/interaction.ts";
import { activitySignature, createPollingController } from "./controllers/polling.ts";
import { createRoutingController } from "./controllers/routing.ts";
import { createSelectionOverlayController } from "./controllers/selection-overlay.ts";
import { createSelectionController } from "./controllers/selection.ts";
import {
  createAnnotationHashRoute,
  createMapHashRoute,
  createSelectionHashRoute,
  parseHashRoute,
} from "./deep-links.ts";
// Edit this source, then run `pnpm build:public` to regenerate public/app.js.
import {
  activityActorLabel,
  buildActivityFogState,
  boundsCenter as modelBoundsCenter,
  canvasKeyboardAction,
  canRenderSourceText,
  createActivityDrawer,
  createDrawController,
  createFogDrawer,
  documentKeyboardAction,
  doubleClickMapAction,
  folderDisplayName,
  hashString,
  hitTestActivityEvents,
  hitTestAnnotations,
  hitTestTargetLists,
  isSpaceKeyEvent,
  isScreenBoxVisible,
  KEYBOARD_ZOOM_FACTOR,
  labelBoxesOverlap,
  lineAtWorldPoint,
  mapHoverLabel,
  mapSearchAction,
  mapSearchMatch,
  mapSelectionPanel,
  mapTargetSelectionAction,
  normalizeActivityState,
  organicRegionFolders,
  pathFromDeepLink,
  panViewForDrag,
  panViewByScreenDelta,
  reconciledSelectedTarget,
  screenBoundsForView,
  screenToWorldPoint,
  sourceContextRequest,
  sourcePanelLineRangeForBox,
  sourcePanelState,
  viewForBounds,
  viewForReadableFile,
  worldToScreenPoint,
} from "./render/index.ts";
import type {
  ActivityEvent,
  ActivityFogState,
  Bounds,
  CodecharterCodemap,
  MapFile,
  MapFolder,
  MapActionOf,
  MapRouteKind,
  NamedPlace,
  Point,
  SearchMatch,
  SourceRange,
  TargetHit,
  View,
  Viewport,
} from "./render/index.ts";

type BrowserControl = HTMLElement & {
  checked?: boolean;
  disabled?: boolean;
  value?: string;
  elements?: Record<string, { value?: string }>;
  reset?: () => void;
};
const CONTROL_SELECTORS = [
  ["summary", "#mapSummary"],
  ["hover", "#hoverReadout"],
  ["viewport", "#viewportReadout"],
  ["selectionPopover", "#selectionPopover"],
  ["annotationActions", "#annotationActions"],
  ["selectionContext", "#selectionContext"],
  ["annotationTitle", "#annotationTitle"],
  ["annotationMeta", "#annotationMeta"],
  ["annotationFeedback", "#annotationFeedback"],
  ["inspectorTitle", "#inspectorTitle"],
  ["inspectorSubtitle", "#inspectorSubtitle"],
  ["searchForm", "#searchForm"],
  ["searchInput", "#searchInput"],
  ["searchResult", "#searchResult"],
  ["selectTool", "#selectTool"],
  ["panTool", "#panTool"],
  ["resetViewTool", "#resetViewTool"],
  ["drawTool", "#drawTool"],
  ["clearActivityTool", "#clearActivityTool"],
  ["saveSelection", "#saveSelection"],
  ["deleteAnnotation", "#deleteAnnotation"],
  ["copyAnnotationPrompt", "#copyAnnotationPrompt"],
  ["editAnnotation", "#editAnnotation"],
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
] as const satisfies readonly (readonly [string, string])[];
type BrowserControlName = (typeof CONTROL_SELECTORS)[number][0];
const LAYER_TOGGLE_CONTROLS = [
  "showFolders",
  "showOrganicRegions",
  "showFiles",
  "showNames",
  "showActivity",
  "showGrid",
] as const satisfies readonly BrowserControlName[];
type BrowserControls = Record<BrowserControlName, BrowserControl | null> & {
  layerToggles: () => BrowserControl[];
};
type CanvasAction = NonNullable<ReturnType<typeof canvasKeyboardAction>>;
type DocumentAction = NonNullable<ReturnType<typeof documentKeyboardAction>>;
type TimerHandle = number | ReturnType<typeof setTimeout> | null;
type AnnotationHit = NamedPlace & { targetType: "annotation" };
type ActivityHit = ActivityEvent & { targetType: "activity" };
type HitTarget = TargetHit | AnnotationHit | ActivityHit;
type PlaceSearchMatch = Extract<SearchMatch, { type: "annotation" | "namedPlace" }>;
type FileSearchMatch = Extract<SearchMatch, { type: "file" }>;
type FolderSearchMatch = Extract<SearchMatch, { type: "folder" }>;
type DoubleClickAction = MapActionOf<
  "focusAnnotation" | "selectFolder" | "selectFile" | "selectActivity"
>;
type TargetSelectionAction = MapActionOf<
  "clearSelection" | "focusAnnotation" | "selectActivity" | "inspectFolder" | "inspectFile"
>;
type SearchAction = MapActionOf<"noMatch" | "focusPlace" | "focusFile" | "focusFolder">;
type ParsedLineRange = { start: number; end: number };
type ResolvedSelection = {
  level?: string;
  geometry: { bounds: Bounds };
  resolvedTargets?: unknown[];
  spatialFrame?: { level?: string; corners?: { northWest?: string } };
  coveringSet?: string[];
};
type SourcePanel = {
  sourceTitle: string;
  sourceOutput: string;
  scrollTop?: number;
};
type FrameLabel = {
  text: string;
  box: Bounds;
  color: string;
  size: number;
  weight: string;
  priority: number;
};
type PlacedFrameLabel = FrameLabel & { x: number; y: number; collisionBox: Bounds };
type MapDrag =
  | { type: "draw"; start: Point; current: Point }
  | { type: "pan"; start: Point; view: View; transient?: boolean }
  | { type: "select"; start: Point; world: Point };
type PointerDownState = { screen: Point; world: Point };
type ActivityDetail = "summary" | "full";
type MapVersionResponse = { version?: string };
type NamedPlacesResponse = { places: NamedPlace[]; overlaps?: Array<{ bounds: Bounds }> };
type ActivityResponse = { events?: ActivityEvent[]; version?: string; unchanged?: true };
type ResolvedAddressResponse = { targetType: MapRouteKind; geohash: string; deepLink: string };
type MapApplicationState = {
  map: CodecharterCodemap | null;
  mapFolders: MapFolder[];
  mapFiles: MapFile[];
  organicRegionFolders: Array<{ folder: MapFolder; depth: number }>;
  mapVersion: string;
  namedPlaces: NamedPlace[];
  namedPlacesById: Map<string, NamedPlace>;
  namedPlaceIndexesById: Map<string, number>;
  overlaps: Array<{ bounds: Bounds }>;
  activity: ActivityEvent[];
  activityFog: ActivityFogState | null;
  sourceCache: Map<string, SourceRange>;
  pendingSourceRequests: Set<string>;
  activitySignature: string;
  activityVersion: string;
  activityDetail: ActivityDetail;
  view: View;
  cameraAnimation: { frame: number } | null;
  pendingClickSelection: TimerHandle;
  dragging: MapDrag | null;
  lastPointerDown: PointerDownState | null;
  lastPointerType: string;
  drawing: boolean;
  panning: boolean;
  spacePanning: boolean;
  draftSelection: { type: "rect"; bounds: Bounds } | null;
  resolvedSelection: ResolvedSelection | null;
  editingAnnotation: AnnotationHit | null;
  selectedTarget: HitTarget | null;
  clearSourceState(): void;
};

const canvas = requiredElement(
  document.querySelector<HTMLCanvasElement>("#mapCanvas"),
  "map canvas",
);
const ctx = requiredContext(canvas.getContext("2d"), "map canvas context");
const fogMaskCanvas = document.createElement("canvas");
const fogMaskCtx = requiredContext(fogMaskCanvas.getContext("2d"), "fog mask canvas context");
const fogLayerCanvas = document.createElement("canvas");
const fogLayerCtx = requiredContext(fogLayerCanvas.getContext("2d"), "fog layer canvas context");
const fogVeilCanvas = document.createElement("canvas");
const fogVeilCtx = requiredContext(fogVeilCanvas.getContext("2d"), "fog veil canvas context");
const mapArea = requiredElement(document.querySelector<HTMLElement>(".map-area"), "map area");
const DEFAULT_MAP_LEVEL = "file";
const SAVE_AND_COPY_LABEL = "Save & Copy Prompt";
const COPY_PROMPT_LABEL = "Copy Prompt";
const DELETE_ANNOTATION_LABEL = "Delete";
const CONFIRM_DELETE_ANNOTATION_LABEL = "Confirm Delete";
const CAMERA_ANIMATION_MS = 280;
const DOUBLE_CLICK_ZOOM_FACTOR = 2;
const CLICK_SELECT_DELAY_MS = 220;
const TOUCH_SPACE_PAN_HOLD_MS = 220;
const DELETE_ANNOTATION_CONFIRM_MS = 4000;
const FOG_MASK_SCALE = 0.5;

function createMapApplicationState(): MapApplicationState {
  const sourceCache = new Map<string, SourceRange>();
  const pendingSourceRequests = new Set<string>();
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
    activityVersion: "",
    activityDetail: "summary",
    view: { x: 0, y: 0, scale: 1 },
    cameraAnimation: null,
    pendingClickSelection: null,
    dragging: null,
    lastPointerDown: null,
    lastPointerType: "",
    drawing: false,
    panning: true,
    spacePanning: false,
    draftSelection: null,
    resolvedSelection: null,
    editingAnnotation: null,
    selectedTarget: null,
    clearSourceState() {
      sourceCache.clear();
      pendingSourceRequests.clear();
    },
  };
}

function createMapControls(root: Document = document): BrowserControls {
  const controls = Object.fromEntries(
    CONTROL_SELECTORS.map(([name, selector]) => [
      name,
      root.querySelector<BrowserControl>(selector),
    ]),
  ) as Record<BrowserControlName, BrowserControl | null>;

  return Object.assign(controls, {
    layerToggles: () =>
      LAYER_TOGGLE_CONTROLS.map((name) => controls[name]).filter(
        (control): control is BrowserControl => control !== null,
      ),
  });
}

let frameLabels: PlacedFrameLabel[] = [];
let frameViewport: Viewport | null = null;
let fogVeilCacheKey = "";
let pendingRenderFrame = 0;
let pendingTouchSpacePan: TimerHandle = null;
let copyPromptLabelTimer: TimerHandle = null;
const hashUnitCache = new Map<string, number>();
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const state: MapApplicationState = createMapApplicationState();
const controls = createMapControls();
const camera = createCameraController({
  getView: () => state.view,
  setView: (view) => {
    state.view = view;
  },
  setViewImmediate,
  animateViewTo,
  viewportSize,
  canvasClientSize: () => ({ width: canvas.clientWidth, height: canvas.clientHeight }),
});
const selection = createSelectionController<ResolvedSelection>({
  level: DEFAULT_MAP_LEVEL,
  getDrawDrag: () => (state.dragging?.type === "draw" ? state.dragging : null),
  getDraft: () => state.draftSelection,
  setDraft: (draft) => {
    state.draftSelection = draft;
  },
  setResolved: (resolved) => {
    state.resolvedSelection = resolved;
  },
  getView: () => state.view,
  viewportSize,
  resolveSelection: (body) => postJson<ResolvedSelection>("/api/selections/resolve", body),
  isCurrentRoute: (token) => routing.isCurrentRoute(token),
  syncSelectionRoute: (bounds, level) =>
    routing.syncHashRoute(createSelectionHashRoute({ level, bounds })),
  onResolved: () => {
    if (controls.saveSelection) {
      controls.saveSelection.disabled = false;
    }
    setSaveButtonLabel();
    updateSelectionPopover();
    focusSelectionComment();
    setSelectionStatus(
      "Selection ready. Add a comment, then save or press Command Enter on macOS or Control Enter elsewhere.",
    );
    render();
  },
});
const selectionOverlay = createSelectionOverlayController({
  state,
  controls,
  defaultMapLevel: DEFAULT_MAP_LEVEL,
  saveAndCopyLabel: SAVE_AND_COPY_LABEL,
  copyPromptLabel: COPY_PROMPT_LABEL,
  getAnnotationTitle: (annotation) => editing.annotationTitle(annotation),
  getSelectedAnnotation: () => editing.selectedAnnotation(),
  clearEditingPendingDelete: () => editing.clearPendingDelete(),
  updateInteractionModeUi: () => interaction.updateInteractionModeUi(),
  setSaveButtonLabel,
  setSelectionStatus,
  screenBounds,
  canvasSize: () => ({ clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight }),
});
const updateSelectionPopover = selectionOverlay.updateSelectionPopover;
const positionAnnotationActions = selectionOverlay.positionAnnotationActions;
const resetSelectionOverlay = selectionOverlay.resetSelectionOverlay;
const clearDraftSelection = selectionOverlay.clearDraftSelection;
const setNamedPlaces = selectionOverlay.setNamedPlaces;
const interaction = createInteractionController({
  getDrawing: () => state.drawing,
  setDrawing: (value) => {
    state.drawing = value;
  },
  getPanning: () => state.panning,
  setPanning: (value) => {
    state.panning = value;
  },
  getSpacePanning: () => state.spacePanning,
  setSpacePanning: (value) => {
    state.spacePanning = value;
  },
  setSelectedTarget: (target) => {
    state.selectedTarget = target;
  },
  setEditingAnnotation: (annotation) => {
    state.editingAnnotation = annotation;
  },
  getDragging: () => state.dragging,
  canvas,
  selectToolEl: controls.selectTool,
  panToolEl: controls.panTool,
  drawToolEl: controls.drawTool,
  clearDraftSelection,
  setSelectionStatus,
  updateSelectionPopover,
});
const editing = createEditingController({
  controls,
  defaultMapLevel: DEFAULT_MAP_LEVEL,
  saveAndCopyLabel: SAVE_AND_COPY_LABEL,
  copyPromptLabel: COPY_PROMPT_LABEL,
  deleteAnnotationLabel: DELETE_ANNOTATION_LABEL,
  confirmDeleteAnnotationLabel: CONFIRM_DELETE_ANNOTATION_LABEL,
  deleteAnnotationConfirmMs: DELETE_ANNOTATION_CONFIRM_MS,
  state,
  getEditingAnnotation: () => state.editingAnnotation,
  setEditingAnnotation: (annotation) => {
    state.editingAnnotation = annotation;
  },
  getSelectedTarget: () => state.selectedTarget,
  setSelectedTarget: (target) => {
    state.selectedTarget = target as HitTarget | null;
  },
  getDraftSelection: () => state.draftSelection,
  setDraftSelection: (draft) => {
    state.draftSelection = draft;
  },
  getResolvedSelection: () => state.resolvedSelection,
  setResolvedSelection: (resolved) => {
    state.resolvedSelection = resolved;
  },
  setSaveButtonLabel,
  setCopyButtonLabel,
  setSelectionStatus,
  updateSelectionPopover,
  positionAnnotationActions,
  focusSelectionComment,
  updateInteractionModeUi: interaction.updateInteractionModeUi,
  render,
  postJson,
  syncHashRoute: (hash) => routing.syncHashRoute(hash),
  createAnnotationHashRoute,
});
const routing = createRoutingController({
  getMap: () => state.map,
  getNamedPlacesById: () => state.namedPlacesById,
  setDrawing: (value) => {
    state.drawing = value;
  },
  setSelectedTarget: (target) => {
    state.selectedTarget = target;
  },
  setDraftSelection: (draft) => {
    state.draftSelection = draft;
  },
  controls,
  resetSelectionOverlay,
  updateInteractionModeUi: () => interaction.updateInteractionModeUi(),
  updateSelectionPopover,
  setSelectionStatus,
  zoomToBounds,
  zoomToReadableFile,
  lineRatioForLine,
  parseLineRange,
  applySourcePanel,
  fetchSourceContext,
  fetchJson,
  setText,
  render,
  editing: {
    upsertNamedPlace: (place) => editing.upsertNamedPlace(place),
    selectAnnotation: (annotation) => editing.selectAnnotation(annotation),
    clearAnnotationForm: () => editing.clearAnnotationForm(),
  },
  selection: {
    preview: (options) => selection.preview(options),
  },
});
const applyHashRoute = routing.applyHashRoute;
const polling = createPollingController({
  getActivityDetail: () => state.activityDetail,
  setActivityDetail: (detail) => {
    state.activityDetail = detail;
  },
  getActivityVersion: () => state.activityVersion,
  setActivityVersion: (version) => {
    state.activityVersion = version;
  },
  getActivitySignature: () => state.activitySignature,
  setActivitySignature: (sig) => {
    state.activitySignature = sig;
  },
  setActivity: (events) => {
    state.activity = events;
  },
  getMapVersion: () => state.mapVersion,
  setOverlaps: (overlaps) => {
    state.overlaps = overlaps;
  },
  activityDiscoveryEnabled,
  fetchJson,
  applyMap,
  setNamedPlaces,
  rebuildActivityFog,
  render,
  setHoverText: (message) => setText(controls.hover, message),
});
const activityGesture = createActivityGestureController({
  clearActivityTool: controls.clearActivityTool,
  setHoverText: (text) => setText(controls.hover, text),
  clearActivityHistory,
});
const fogDrawer = createFogDrawer({
  getActivityFog: () => state.activityFog,
  getActivity: () => state.activity,
  getMap: () => state.map,
  getViewScale: () => state.view.scale,
  ctx,
  canvas,
  fogMaskCtx,
  fogMaskCanvas,
  fogLayerCtx,
  fogLayerCanvas,
  fogVeilCtx,
  fogVeilCanvas,
  getFogVeilCacheKey: () => fogVeilCacheKey,
  setFogVeilCacheKey: (key) => {
    fogVeilCacheKey = key;
  },
  screenBounds,
  visible,
  worldToScreen,
  hashUnit,
  integerNoise,
  fogMaskScale: FOG_MASK_SCALE,
});
const draw = createDrawController({
  ctx,
  canvasSize: () => ({ width: canvas.clientWidth, height: canvas.clientHeight }),
  viewportSize,
  getView: () => state.view,
  getMapFolders: () => state.mapFolders,
  getMapFiles: () => state.mapFiles,
  getOrganicRegionFolders: () => state.organicRegionFolders,
  getActivityFog: () => state.activityFog,
  getNamedPlaces: () => state.namedPlaces,
  getSelectedTarget: () => state.selectedTarget,
  getSourceCache: () => state.sourceCache,
  getPendingSourceRequests: () => state.pendingSourceRequests,
  isDiscoveryEnabled: activityDiscoveryEnabled,
  drawRect,
  drawLabel,
  queueLabelInBox,
  drawSelection,
  render,
  fetchJson,
});
const activityDrawer = createActivityDrawer({
  ctx,
  getActivity: () => state.activity,
  getSelectedTarget: () => state.selectedTarget,
  getViewScale: () => state.view.scale,
  getActivitySignature: () => state.activitySignature,
  activityFeedEl: controls.activityFeed,
  worldToScreen,
  screenBounds,
  hashUnit,
  isDiscoveryEnabled: activityDiscoveryEnabled,
  drawLabel,
  onActivityFeedItemClick: (event) => {
    void selectActivityEvent(event);
  },
  activityPathLabel,
});

async function boot() {
  const [map, mapVersion, names, activity] = await Promise.all([
    fetchJson<CodecharterCodemap>("/api/map"),
    fetchJson<MapVersionResponse>("/api/map-version"),
    fetchJson<NamedPlacesResponse>("/api/named-places"),
    fetchJson<ActivityResponse>(polling.activityRequestUrl("summary")),
  ]);
  applyMap(map, mapVersion.version);
  setNamedPlaces(names.places);
  state.overlaps = names.overlaps ?? [];
  state.activity = activity.events ?? [];
  state.activitySignature = activitySignature(state.activity);
  state.activityVersion =
    typeof activity.version === "string" ? activity.version : state.activitySignature;
  state.activityDetail = "summary";
  rebuildActivityFog();
  bindEvents();
  interaction.updateInteractionModeUi();
  polling.startMapPolling();
  polling.startActivityPolling();
  resize();
  await applyHashRoute();
  render();
}

function applyMap(map: CodecharterCodemap, version: string | undefined) {
  const previousSelection = state.selectedTarget;
  state.map = map;
  state.mapFolders = Object.values(map.folders ?? {});
  state.mapFiles = Object.values(map.files ?? {});
  state.organicRegionFolders = organicRegionFolders(map);
  draw.clearCaches();
  state.mapVersion = version ?? state.mapVersion;
  state.clearSourceState();
  rebuildActivityFog();
  if (controls.summary) {
    controls.summary.textContent = `${state.mapFiles.length} files, ${state.mapFolders.length} folders`;
  }
  reconcileSelectedTarget(previousSelection);
}

function reconcileSelectedTarget(target: HitTarget | null) {
  if (!state.map) {
    state.selectedTarget = target;
    return;
  }
  const reconciled = reconciledSelectedTarget(state.map, target);
  state.selectedTarget = isHitTarget(reconciled) ? reconciled : null;
}

function isHitTarget(value: unknown): value is HitTarget {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "targetType" in value &&
    (value.targetType === "file" ||
      value.targetType === "folder" ||
      value.targetType === "annotation" ||
      value.targetType === "activity")
  );
}

function rebuildActivityFog() {
  state.activityFog = buildActivityFogState(state.map, state.activity);
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
  window.addEventListener("blur", () => interaction.setSpacePanMode(false));

  for (const control of controls.layerToggles()) {
    if (control === controls.showActivity) {
      control.addEventListener("change", () => {
        void polling.handleActivityToggle();
      });
    } else {
      control.addEventListener("change", render);
    }
  }

  controls.selectTool?.addEventListener("click", () => {
    interaction.setSelectMode();
    render();
  });
  controls.drawTool?.addEventListener("click", () => {
    interaction.setDrawMode(!state.drawing);
    render();
  });
  controls.panTool?.addEventListener("click", () => {
    interaction.setPanMode();
    render();
  });
  controls.resetViewTool?.addEventListener("click", () => fitCodebaseView({ animate: true }));

  controls.searchForm?.addEventListener("submit", searchMap);
  controls.saveSelection?.addEventListener("click", () => editing.saveSelection());
  controls.deleteAnnotation?.addEventListener("click", () => editing.deleteSelectedAnnotation());
  controls.copyAnnotationPrompt?.addEventListener("click", () =>
    editing.copySelectedAnnotationPrompt(),
  );
  controls.editAnnotation?.addEventListener("click", () => editing.editSelectedAnnotation());
  controls.deleteAnnotationAction?.addEventListener("click", () =>
    editing.deleteSelectedAnnotation(),
  );
  controls.activityForm?.addEventListener("submit", addActivity);
  activityGesture.bindClearActivityHold();

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
  canvas.setAttribute(
    "aria-label",
    "CodeCharter map canvas. Use the pointer tool to select items, the hand tool or Space drag to pan, arrow keys to pan, plus and minus to zoom, double click to zoom in, 0 to fit the codebase, Enter to select the center, and Escape to cancel the current action.",
  );
  canvas.addEventListener("keydown", onCanvasKeyDown);
  interaction.updateInteractionModeUi();
}

await boot();

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
  fogVeilCanvas.width = canvas.width;
  fogVeilCanvas.height = canvas.height;
  fogVeilCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  fogVeilCacheKey = "";
}

function render() {
  if (pendingRenderFrame) {
    cancelAnimationFrame(pendingRenderFrame);
    pendingRenderFrame = 0;
  }
  const rect = canvas.getBoundingClientRect();
  frameViewport = { width: canvas.clientWidth, height: canvas.clientHeight };
  frameLabels = [];
  try {
    ctx.clearRect(0, 0, rect.width, rect.height);
    setText(controls.viewport, `scale ${state.view.scale.toFixed(2)} | level ${DEFAULT_MAP_LEVEL}`);

    draw.drawCompassRose();
    if (layerEnabled("showGrid", false)) {
      draw.drawGrid();
    }
    if (layerEnabled("showFolders")) {
      draw.drawFolders();
    }
    if (layerEnabled("showOrganicRegions")) {
      draw.drawOrganicRegions();
    }
    if (layerEnabled("showFiles")) {
      draw.drawFiles();
    }
    drawQueuedLabels();
    if (layerEnabled("showNames")) {
      draw.drawNamedPlaces();
    }
    if (layerEnabled("showNames")) {
      drawOverlaps();
    }
    if (state.draftSelection) {
      drawSelection(state.draftSelection.bounds, "rgba(245, 158, 11, 0.18)", "#f59e0b", [6, 4]);
    }
    if (activityDiscoveryEnabled()) {
      fogDrawer.drawDiscoveryFogOverlay(rect);
    }
    if (activityDiscoveryEnabled()) {
      activityDrawer.drawActivity();
    }
    activityDrawer.renderActivityFeed();
    const annotation = editing.selectedAnnotation();
    const annotationActionsVisible =
      annotation !== null &&
      state.draftSelection === null &&
      state.resolvedSelection === null &&
      state.editingAnnotation === null;
    positionAnnotationActions(annotation, { visible: annotationActionsVisible });
  } finally {
    frameViewport = null;
  }
}

function requestRender() {
  if (pendingRenderFrame) {
    return;
  }
  pendingRenderFrame = requestAnimationFrame(() => {
    pendingRenderFrame = 0;
    render();
  });
}

function layerEnabled(name: BrowserControlName, fallback = true) {
  return controls[name]?.checked ?? fallback;
}

function activityDiscoveryEnabled() {
  return controls.showActivity?.checked === true;
}

// Discovery-fog drawing (veil/mask/reveal/mycelium orchestration) lives in
// `render/fog.ts`; the render loop calls into `fogDrawer` (wired below).

function drawOverlaps() {
  for (const overlap of state.overlaps) {
    const box = screenBounds(overlap.bounds);
    if (!visible(box)) {
      continue;
    }
    ctx.save();
    ctx.fillStyle = "rgba(225, 29, 72, 0.18)";
    ctx.strokeStyle = "#e11d48";
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    drawRect(box);
    ctx.restore();
    if (box.width > 44 && box.height > 16) {
      drawLabel("Overlap", box.x + 6, box.y + 16, "#9f1239");
    }
  }
}

// Activity drawing (membranes/cells/trails/tissue markers) + the activity feed
// live in `render/activity.ts`; the render loop calls into `activityDrawer`
// (wired below). The pure colour/age helpers (`activityFillColor`,
// `hexToRgba`, …) are exported from that module and unit-tested there.

function hashUnit(value: string) {
  const cached = hashUnitCache.get(value);
  if (cached !== undefined) {
    return cached;
  }
  const unit = hashString(value) / 0xffffffff;
  hashUnitCache.set(value, unit);
  return unit;
}

function integerNoise(x: number, y: number) {
  let value = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
}

function drawSelection(bounds: Bounds, fill: string, stroke: string, dash: number[]) {
  const box = screenBounds(bounds);
  ctx.save();
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.setLineDash(dash);
  drawRect(box);
  ctx.restore();
}

function drawRect(box: Bounds) {
  const viewport = viewportSize();
  const overdraw =
    box.x < 0 ||
    box.y < 0 ||
    box.x + box.width > viewport.width ||
    box.y + box.height > viewport.height;
  if (overdraw && box.width * box.height > viewport.width * viewport.height * 4) {
    drawClippedRect(box, viewport);
    return;
  }
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.width, box.height);
  ctx.fill();
  ctx.stroke();
}

function drawClippedRect(box: Bounds, viewport: Viewport) {
  const x1 = Math.max(0, box.x);
  const y1 = Math.max(0, box.y);
  const x2 = Math.min(viewport.width, box.x + box.width);
  const y2 = Math.min(viewport.height, box.y + box.height);
  if (x2 <= x1 || y2 <= y1) {
    return;
  }

  ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
  ctx.beginPath();
  if (box.x >= 0 && box.x <= viewport.width) {
    ctx.moveTo(box.x, y1);
    ctx.lineTo(box.x, y2);
  }
  const right = box.x + box.width;
  if (right >= 0 && right <= viewport.width) {
    ctx.moveTo(right, y1);
    ctx.lineTo(right, y2);
  }
  if (box.y >= 0 && box.y <= viewport.height) {
    ctx.moveTo(x1, box.y);
    ctx.lineTo(x2, box.y);
  }
  const bottom = box.y + box.height;
  if (bottom >= 0 && bottom <= viewport.height) {
    ctx.moveTo(x1, bottom);
    ctx.lineTo(x2, bottom);
  }
  ctx.stroke();
}

function drawLabel(text: string, x: number, y: number, color: string, size = 12, weight = "400") {
  ctx.save();
  ctx.font = `${weight} ${size}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, x, y);
  ctx.restore();
}

function queueLabelInBox(label: FrameLabel) {
  const placement = labelPlacement(label.text, label.box, label.size, label.weight);
  if (!placement) {
    return;
  }
  frameLabels.push({ ...label, ...placement });
}

function drawQueuedLabels() {
  const placed: Bounds[] = [];
  if (!labelsAreInPriorityOrder(frameLabels)) {
    frameLabels.sort((a, b) => b.priority - a.priority);
  }
  for (const label of frameLabels) {
    if (placed.some((other) => labelBoxesOverlap(label.collisionBox, other))) {
      continue;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(label.box.x, label.box.y, label.box.width, label.box.height);
    ctx.clip();
    drawLabel(label.text, label.x, label.y, label.color, label.size, label.weight);
    ctx.restore();
    placed.push(label.collisionBox);
  }
}

function labelsAreInPriorityOrder(labels: PlacedFrameLabel[]) {
  for (let index = 1; index < labels.length; index += 1) {
    const previous = labels[index - 1];
    const current = labels[index];
    if (!previous || !current || previous.priority < current.priority) {
      return false;
    }
  }
  return true;
}

function labelPlacement(
  text: string,
  box: Bounds,
  size = 12,
  weight = "400",
): Pick<PlacedFrameLabel, "x" | "y" | "collisionBox"> | null {
  const area = screenIntersection(box);
  if (!area || area.width < 56 || area.height < size + 8) {
    return null;
  }

  ctx.save();
  ctx.font = `${weight} ${size}px Inter, system-ui, sans-serif`;
  const width = Math.min(area.width - 12, ctx.measureText(text).width);
  ctx.restore();

  const x = clamp(box.x + 8, area.x + 8, area.x + Math.max(8, area.width - width - 6));
  const naturalY = box.y + size + 5;
  const stickyY =
    area.y + Math.min(Math.max(size + 8, area.height * 0.35), Math.max(size + 8, area.height - 8));
  const y = clamp(
    naturalY < area.y + size + 6 ? stickyY : naturalY,
    area.y + size + 6,
    area.y + area.height - 8,
  );

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

function onWheel(event: WheelEvent) {
  event.preventDefault();
  cancelCameraAnimation();
  const mouse = screenPoint(event);
  if (event.ctrlKey || event.metaKey) {
    camera.zoomAt(mouse, camera.wheelZoomFactor(event));
  } else {
    camera.panByWheel(event);
  }
  requestRender();
}

function onCanvasKeyDown(event: KeyboardEvent) {
  canvas.classList.remove("pointer-focused");
  const action = canvasKeyboardAction(event);
  if (!action) {
    return;
  }
  event.preventDefault();
  void handleCanvasKeyboardAction(action);
}

function onDocumentKeyDown(event: KeyboardEvent) {
  const action = documentKeyboardAction(event, {
    textEntry: isTextEntryTarget(event.target),
    buttonTarget: isButtonTarget(event.target),
    hasResolvedSelection: state.resolvedSelection !== null,
    hasSelectedAnnotation: state.selectedTarget?.targetType === "annotation",
  });
  if (!action) {
    return;
  }
  event.preventDefault();
  void handleDocumentKeyboardAction(action);
}

async function handleCanvasKeyboardAction(action: CanvasAction): Promise<void> {
  switch (action.type) {
    case "pan":
      animateViewTo(panViewByScreenDelta(state.view, action.delta, viewportSize()));
      return;
    case "zoomIn":
      camera.zoomAt(camera.viewportCenter(), KEYBOARD_ZOOM_FACTOR, { animate: true });
      return;
    case "zoomOut":
      camera.zoomAt(camera.viewportCenter(), 1 / KEYBOARD_ZOOM_FACTOR, { animate: true });
      return;
    case "fitCodebase":
      fitCodebaseView({ animate: true });
      return;
    case "selectCenter":
      await selectMapTarget(screenToWorld(camera.viewportCenter()));
  }
}

async function handleDocumentKeyboardAction(action: DocumentAction): Promise<void> {
  switch (action.type) {
    case "startSpacePan":
      interaction.setSpacePanMode(true);
      return;
    case "cancelInteraction":
      cancelCurrentInteraction();
      return;
    case "saveSelection":
      await editing.saveSelection();
      return;
    case "copyAnnotationPrompt":
      await editing.copySelectedAnnotationPrompt();
      return;
    case "deleteAnnotation":
      await editing.deleteSelectedAnnotation();
  }
}

function onDocumentKeyUp(event: KeyboardEvent) {
  if (isSpaceKeyEvent(event) && state.spacePanning) {
    event.preventDefault();
    interaction.setSpacePanMode(false);
  }
}

function isTextEntryTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function isButtonTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLButtonElement ||
    (target instanceof Element && target.closest("button") !== null)
  );
}

function cancelCurrentInteraction() {
  cancelPendingTouchSpacePan();
  cancelPendingClickSelection();
  if (state.editingAnnotation) {
    state.editingAnnotation = null;
    if (controls.selectionComment) {
      controls.selectionComment.value = "";
    }
    updateSelectionPopover();
    setSelectionStatus("Edit cancelled.");
    render();
    canvas.focus({ preventScroll: true });
    return;
  }

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
    if (controls.selectionComment) {
      controls.selectionComment.value = "";
    }
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

function onPointerDown(event: PointerEvent) {
  cancelCameraAnimation();
  cancelPendingTouchSpacePan();
  if (state.dragging?.type !== "select") {
    cancelPendingClickSelection();
  }
  canvas.classList.add("pointer-focused");
  try {
    canvas.setPointerCapture(event.pointerId);
  } catch {
    // Synthetic pointer events and some interrupted touch streams have no active pointer to capture.
  }
  canvas.focus({ preventScroll: true });
  const screen = screenPoint(event);
  const point = screenToWorld(screen);
  const spacePan = isSpacePanPointerEvent(event);
  state.lastPointerDown = { screen, world: point };
  state.lastPointerType = event.pointerType;
  if (state.drawing && !spacePan) {
    state.selectedTarget = null;
    state.dragging = { type: "draw", start: point, current: point };
    state.draftSelection = {
      type: "rect",
      bounds: { x: point.x, y: point.y, width: 0, height: 0 },
    };
    render();
  } else if (state.panning || spacePan) {
    state.dragging = {
      type: "pan",
      start: screenPoint(event),
      view: { ...state.view },
      transient: spacePan,
    };
  } else {
    state.dragging = { type: "select", start: screen, world: point };
    scheduleTouchSpacePan(event);
  }
  interaction.updateInteractionModeUi();
}

function isSpacePanPointerEvent(event: PointerEvent) {
  return state.spacePanning || event.getModifierState?.("Space") === true;
}

function scheduleTouchSpacePan(event: PointerEvent) {
  if (event.pointerType !== "touch") {
    return;
  }
  pendingTouchSpacePan = window.setTimeout(() => {
    pendingTouchSpacePan = null;
    if (state.dragging?.type !== "select" || !state.lastPointerDown) {
      return;
    }
    interaction.setSpacePanMode(true);
    state.dragging = {
      type: "pan",
      start: state.lastPointerDown.screen,
      view: { ...state.view },
      transient: true,
    };
    interaction.updateInteractionModeUi();
  }, TOUCH_SPACE_PAN_HOLD_MS);
}

function cancelPendingTouchSpacePan() {
  if (!pendingTouchSpacePan) {
    return;
  }
  window.clearTimeout(pendingTouchSpacePan);
  pendingTouchSpacePan = null;
}

function onPointerMove(event: PointerEvent) {
  const screen = screenPoint(event);
  const world = screenToWorld(screen);
  if (state.dragging?.type === "select" && state.lastPointerDown) {
    const moved = Math.hypot(
      screen.x - state.lastPointerDown.screen.x,
      screen.y - state.lastPointerDown.screen.y,
    );
    if (moved > 4) {
      cancelPendingTouchSpacePan();
    }
  }
  const hit = hitTest(world);
  setText(
    controls.hover,
    hit ? mapHoverLabel(hit) : `x ${world.x.toFixed(4)}, y ${world.y.toFixed(4)}`,
  );

  if (!state.dragging) {
    return;
  }
  if (state.dragging.type === "select") {
    return;
  }
  if (state.dragging.type === "pan") {
    state.view = panViewForDrag(state.dragging, screen, viewportSize());
  } else {
    selection.updateDraft(world);
  }
  requestRender();
}

async function onPointerUp(event: PointerEvent) {
  cancelPendingTouchSpacePan();
  const endTouchSpacePan =
    state.dragging?.type === "pan" && state.dragging.transient && event.pointerType === "touch";
  if (state.dragging?.type === "draw" && state.draftSelection) {
    if (event.type !== "lostpointercapture") {
      selection.updateDraft(screenToWorld(screenPoint(event)));
    }
    if (!selection.hasUsableDraft()) {
      clearDraftSelection();
      render();
      return;
    }
    state.dragging = null;
    interaction.updateInteractionModeUi();
    await selection.preview();
    return;
  }

  if (state.dragging?.type === "select" && state.lastPointerDown) {
    const current = screenPoint(event);
    const moved = Math.hypot(
      current.x - state.lastPointerDown.screen.x,
      current.y - state.lastPointerDown.screen.y,
    );
    if (moved < 4) {
      scheduleClickSelection(state.lastPointerDown.world);
    }
  }
  state.dragging = null;
  if (endTouchSpacePan) {
    interaction.setSpacePanMode(false);
  }
  interaction.updateInteractionModeUi();
}

function onPointerCancel(event?: PointerEvent) {
  cancelPendingTouchSpacePan();
  const endTouchSpacePan =
    state.dragging?.type === "pan" && state.dragging.transient && event?.pointerType === "touch";
  state.dragging = null;
  if (endTouchSpacePan) {
    interaction.setSpacePanMode(false);
  }
  interaction.updateInteractionModeUi();
}

function onCanvasDoubleClick(event: MouseEvent) {
  if (state.drawing) {
    return;
  }
  event.preventDefault();
  cancelPendingClickSelection();
  const screen = screenPoint(event);
  const world = screenToWorld(screen);
  const hit = hitTestDrillTarget(world) ?? hitTestAnnotation(world);
  const action = doubleClickMapAction(hit);

  if (action && hit) {
    void handleDoubleClickAction(action, hit, world);
    return;
  }

  camera.zoomAt(screen, DOUBLE_CLICK_ZOOM_FACTOR, { animate: true });
}

function scheduleClickSelection(worldPoint: Point) {
  cancelPendingClickSelection();
  state.pendingClickSelection = window.setTimeout(() => {
    state.pendingClickSelection = null;
    void selectMapTarget(worldPoint);
  }, CLICK_SELECT_DELAY_MS);
}

function cancelPendingClickSelection() {
  if (!state.pendingClickSelection) {
    return;
  }
  window.clearTimeout(state.pendingClickSelection);
  state.pendingClickSelection = null;
}

function hitTestDrillTarget(world: Point) {
  return hitTestActivity(world) ?? hitTestMapTargets(world);
}

async function selectMapTarget(worldPoint: Point) {
  const hit = hitTest(worldPoint);
  const action = mapTargetSelectionAction(hit);
  await handleMapTargetSelectionAction(action, hit, worldPoint);
}

async function handleDoubleClickAction(action: DoubleClickAction, hit: HitTarget, world: Point) {
  switch (action.type) {
    case "focusAnnotation":
      if (hit.targetType !== "annotation" || !hasGeometryBounds(hit)) {
        return;
      }
      zoomToBounds(hit.geometry.bounds, 1.28);
      editing.selectAnnotation(hit);
      return;
    case "selectFolder":
      void selectMapTarget(world);
      if (hit.targetType !== "folder" || !hasBounds(hit)) {
        return;
      }
      zoomToBounds(hit.bounds, 1.35);
      return;
    case "selectFile":
      if (hit.targetType === "file") {
        await inspectFileTarget(hit, world, { zoomReadable: true });
      }
      return;
    case "selectActivity":
      if (hit.targetType === "activity") {
        await selectActivityEvent(hit, { zoomReadable: true });
      }
  }
}

async function handleMapTargetSelectionAction(
  action: TargetSelectionAction,
  hit: HitTarget | null,
  worldPoint: Point,
) {
  switch (action.type) {
    case "clearSelection":
      clearMapSelection();
      return;
    case "focusAnnotation":
      if (hit?.targetType !== "annotation" || !hasGeometryBounds(hit)) {
        return;
      }
      zoomToBounds(hit.geometry.bounds, 1.35);
      editing.selectAnnotation(hit);
      return;
    case "selectActivity":
      if (hit?.targetType === "activity") {
        await selectActivityEvent(hit);
      }
      return;
    case "inspectFolder":
      if (hit?.targetType === "folder") {
        inspectFolderTarget(hit);
      }
      return;
    case "inspectFile":
      if (hit?.targetType === "file") {
        await inspectFileTarget(hit, worldPoint);
      }
  }
}

function clearMapSelection() {
  editing.clearPendingDelete();
  const panel = mapSelectionPanel(null);
  state.selectedTarget = null;
  setText(controls.inspectorTitle, panel.inspectorTitle ?? "");
  setText(controls.inspectorSubtitle, panel.inspectorSubtitle);
  setText(controls.sourceTitle, panel.sourceTitle ?? "");
  setText(controls.sourceOutput, panel.sourceOutput ?? "");
  updateSelectionPopover();
  render();
}

function inspectMapTarget(hit: TargetHit) {
  editing.clearPendingDelete();
  editing.clearAnnotationForm();
  state.selectedTarget = hit;

  const panel = mapSelectionPanel(hit);
  setText(controls.inspectorTitle, panel.inspectorTitle ?? "");
  setText(controls.inspectorSubtitle, panel.inspectorSubtitle ?? "");
  routing.syncHashRoute(
    createMapHashRoute(hit.targetType, hit.geo?.geohash ?? "", { path: hit.path }),
  );
  return panel;
}

function inspectFolderTarget(hit: TargetHit) {
  const panel = inspectMapTarget(hit);
  setText(controls.sourceTitle, panel.sourceTitle ?? "");
  setText(controls.sourceOutput, panel.sourceOutput ?? "");
  render();
}

async function inspectFileTarget(
  hit: MapFile & { targetType: "file" },
  worldPoint: Point,
  { zoomReadable = false } = {},
) {
  if (!hasBounds(hit)) {
    return;
  }
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
  const [address, source] = await fetchSourceContext(sourceContext);
  routing.syncHashRoute(
    createMapHashRoute(address.targetType, address.geohash, {
      path: hit.path,
      lines: sourceContext.lines,
    }),
  );

  applySourcePanel(sourcePanelState({ path: hit.path, deepLink: address.deepLink, source }));
  render();
}

async function selectActivityEvent(event: ActivityEvent, { zoomReadable = false } = {}) {
  state.selectedTarget = { ...event, targetType: "activity" };
  editing.clearAnnotationForm();
  setText(
    controls.inspectorTitle,
    `${activityActorLabel(event)}: ${normalizeActivityState(event.activityState)}`,
  );
  setText(
    controls.inspectorSubtitle,
    `activity: ${activityPathLabel(event)} | ${event.address?.geohash ?? "unresolved"}`,
  );

  const path = pathFromActivity(event);
  if (!path) {
    applySourcePanel(
      sourcePanelState({
        fallbackOutput: event.note || "Activity selected.",
        ...(event.address?.deepLink === undefined ? {} : { deepLink: event.address.deepLink }),
      }),
    );
    render();
    return;
  }

  const lineRange = event.address?.lineRange ?? { start: 1 };
  if (zoomReadable) {
    const file = state.map?.files?.[path];
    if (file) {
      zoomToReadableFile(file, lineRatioForLine(file, lineRange.start));
    }
  }
  const sourceContext = sourceContextRequest(path, lineRange);
  const [address, source] = await fetchSourceContext(sourceContext);
  routing.syncHashRoute(
    createMapHashRoute(address.targetType, address.geohash, { path, lines: sourceContext.lines }),
  );
  applySourcePanel(sourcePanelState({ path, deepLink: address.deepLink, source }));
  render();
}

function fetchSourceContext(
  sourceContext: ReturnType<typeof sourceContextRequest>,
): Promise<[ResolvedAddressResponse, SourceRange]> {
  return Promise.all([
    fetchJson<ResolvedAddressResponse>(sourceContext.resolveUrl),
    fetchJson<SourceRange>(sourceContext.sourceUrl),
  ]);
}

function lineAtPoint(file: MapFile, worldPoint: Point) {
  return lineAtWorldPoint(file, worldPoint);
}

function lineRatioForLine(file: MapFile, line: number) {
  return (line - 0.5) / Math.max(1, file.lineCount ?? 0);
}

function sourcePanelLineRange(file: MapFile, focusLine: number, box: Bounds) {
  return sourcePanelLineRangeForBox(file, focusLine, box, canvas.clientHeight);
}

async function searchMap(event: Event) {
  event.preventDefault();
  const query = controls.searchInput?.value;
  const searchQuery = query ?? "";
  if (!state.map || !searchQuery.trim()) {
    return;
  }
  const match = mapSearchMatch(state.map, state.namedPlaces, searchQuery);
  const action = mapSearchAction(match);
  await handleMapSearchAction(action, match);
}

async function handleMapSearchAction(action: SearchAction, match: SearchMatch | null) {
  switch (action.type) {
    case "noMatch":
      setSearchResult("No matching place found.");
      return;
    case "focusPlace":
      if (!match || (match.type !== "annotation" && match.type !== "namedPlace")) {
        return;
      }
      focusPlaceSearchMatch(match);
      return;
    case "focusFile":
      if (match?.type === "file") {
        await focusFileSearchMatch(match);
      }
      return;
    case "focusFolder":
      if (match?.type === "folder") {
        focusFolderSearchMatch(match);
      }
  }
}

function focusPlaceSearchMatch(match: PlaceSearchMatch) {
  if (!hasGeometryBounds(match.place)) {
    return;
  }
  zoomToBounds(match.place.geometry.bounds, 1.35);
  setSearchResult(match.label ?? "");
  state.selectedTarget = match.target;
  const annotation = editing.selectedAnnotation();
  if (annotation) {
    editing.selectAnnotation(annotation);
  }
  render();
}

async function focusFileSearchMatch(match: FileSearchMatch) {
  if (!hasBounds(match.file)) {
    return;
  }
  zoomToReadableFile(match.file);
  await selectMapTarget(boundsCenter(match.file.bounds));
  setSearchResult(match.label ?? "");
}

function focusFolderSearchMatch(match: FolderSearchMatch) {
  if (!hasBounds(match.folder)) {
    return;
  }
  zoomToBounds(match.folder.bounds, 1.6);
  state.selectedTarget = { ...match.folder, targetType: "folder" };
  setText(controls.inspectorTitle, folderDisplayName(match.folder));
  setText(
    controls.inspectorSubtitle,
    `folder: ${match.folder.path || "."} | ${match.folder.geo?.geohash ?? "unresolved"}`,
  );
  setSearchResult(match.label ?? "");
  render();
}

function setSearchResult(message: string) {
  if (controls.searchResult) {
    controls.searchResult.textContent = message;
  }
}

function setText(element: HTMLElement | null, value: string) {
  if (element) {
    element.textContent = value;
  }
}

function hasBounds<T extends { bounds?: Bounds }>(
  target: T | null | undefined,
): target is T & { bounds: Bounds } {
  return target?.bounds !== undefined;
}

function hasGeometryBounds<T extends { geometry?: { bounds?: Bounds } }>(
  target: T | null | undefined,
): target is T & { geometry: { bounds: Bounds } } {
  return target?.geometry?.bounds !== undefined;
}

function applySourcePanel(panel: SourcePanel) {
  setText(controls.sourceTitle, panel.sourceTitle);
  setText(controls.sourceOutput, panel.sourceOutput);
  if (panel.scrollTop !== undefined && Number.isFinite(panel.scrollTop) && controls.sourceOutput) {
    controls.sourceOutput.scrollTop = panel.scrollTop;
  }
}

function parseLineRange(value: string | null | undefined): ParsedLineRange | null {
  if (!value) {
    return null;
  }
  const match = value.match(/^(\d+)(?:-(\d+))?$/);
  if (!match) {
    return null;
  }
  return {
    start: Number(match[1]),
    end: Number(match[2] ?? match[1]),
  };
}

function focusSelectionComment() {
  if (!controls.selectionComment || state.lastPointerType === "touch") {
    return;
  }
  controls.selectionComment.focus({ preventScroll: true });
}

function setSelectionStatus(message: string) {
  if (controls.selectionStatus) {
    controls.selectionStatus.textContent = message;
  }
}

function setSaveButtonLabel(label = SAVE_AND_COPY_LABEL) {
  if (controls.saveSelection) {
    controls.saveSelection.textContent = label;
  }
}

function setCopyButtonLabel(label = COPY_PROMPT_LABEL, { reset = false } = {}) {
  if (!controls.copyAnnotationPrompt) {
    return;
  }
  if (copyPromptLabelTimer) {
    window.clearTimeout(copyPromptLabelTimer);
    copyPromptLabelTimer = null;
  }
  controls.copyAnnotationPrompt.textContent = label;
  if (reset) {
    copyPromptLabelTimer = window.setTimeout(() => {
      copyPromptLabelTimer = null;
      setCopyButtonLabel();
    }, 1600);
  }
}

async function addActivity(event: SubmitEvent) {
  event.preventDefault();
  if (!(controls.activityForm instanceof HTMLFormElement)) {
    return;
  }
  const data = formDataObject(new FormData(controls.activityForm));
  await postJson("/api/activity", {
    agentId: data.agentId,
    activityState: data.activityState,
    path: data.path,
    lineStart: Number(data.lineStart),
    lineEnd: Number(data.lineEnd),
  });
  setTimeout(polling.refreshActivity, 250);
}

function formDataObject(formData: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(formData);
}

async function clearActivityHistory() {
  if (controls.clearActivityTool) {
    controls.clearActivityTool.disabled = true;
  }
  try {
    await deleteJson("/api/activity");
    state.activity = [];
    state.activitySignature = activitySignature(state.activity);
    state.activityVersion = "";
    state.activityDetail = "summary";
    rebuildActivityFog();
    if (state.selectedTarget?.targetType === "activity") {
      state.selectedTarget = null;
    }
    setText(controls.hover, "Activity cleared");
    render();
  } finally {
    if (controls.clearActivityTool) {
      controls.clearActivityTool.disabled = false;
      controls.clearActivityTool.classList.remove("is-holding");
    }
  }
}

function hitTest(point: Point): HitTarget | null {
  const annotation = hitTestAnnotation(point);
  if (annotation) {
    return annotation;
  }
  const activity = hitTestActivity(point);
  if (activity) {
    return activity;
  }
  return hitTestMapTargets(point);
}

function hitTestMapTargets(point: Point) {
  return hitTestTargetLists(state.mapFiles, state.mapFolders, point);
}

function hitTestAnnotation(point: Point) {
  const radiusX = 15 / (canvas.clientWidth * state.view.scale);
  const radiusY = 15 / (canvas.clientHeight * state.view.scale);
  return hitTestAnnotations(state.namedPlaces, point, { radiusX, radiusY });
}

function hitTestActivity(point: Point) {
  if (!activityDiscoveryEnabled()) {
    return null;
  }
  const radiusX = 13 / (canvas.clientWidth * state.view.scale);
  const radiusY = 13 / (canvas.clientHeight * state.view.scale);
  return hitTestActivityEvents(state.activity, point, { radiusX, radiusY });
}

function zoomToBounds(bounds: Bounds, paddingFactor = 1.2) {
  animateViewTo(viewForBounds(bounds, viewportSize(), paddingFactor));
}

function zoomToReadableFile(file: MapFile, lineRatio = 0.5) {
  const view = viewForReadableFile(file, viewportSize(), lineRatio);
  animateViewTo(view);
  return view;
}

function fitCodebaseView({ animate = false } = {}) {
  const bounds = state.map?.folders?.[""]?.bounds ??
    state.map?.codePlane?.bounds ?? { x: 0, y: 0, width: 1, height: 1 };
  const view = viewForBounds(bounds, viewportSize(), 1.02);
  if (animate) {
    animateViewTo(view);
  } else {
    setViewImmediate(view);
  }
}

function setViewImmediate(view: View) {
  cancelCameraAnimation();
  state.view = view;
  render();
}

function animateViewTo(targetView: View) {
  cancelCameraAnimation();
  if (reducedMotion.matches) {
    setViewImmediate(targetView);
    return;
  }

  const fromView = { ...state.view };
  const startedAt = performance.now();
  state.cameraAnimation = { frame: 0 };

  const step = (now: number) => {
    if (!state.cameraAnimation) {
      return;
    }
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
  if (!state.cameraAnimation) {
    return;
  }
  cancelAnimationFrame(state.cameraAnimation.frame);
  state.cameraAnimation = null;
}

function interpolateView(fromView: View, toView: View, t: number): View {
  return {
    x: fromView.x + (toView.x - fromView.x) * t,
    y: fromView.y + (toView.y - fromView.y) * t,
    scale: fromView.scale + (toView.scale - fromView.scale) * t,
  };
}

function easeCamera(t: number) {
  return 1 - (1 - t) ** 3;
}

function activityPathLabel(event: ActivityEvent) {
  const path = pathFromActivity(event);
  const address = event.address;
  const lines = address?.lineRange ? `:${address.lineRange.start}-${address.lineRange.end}` : "";
  const columns = address?.tokenRange
    ? `@${address.tokenRange.start}-${address.tokenRange.end}`
    : "";
  return `${path || (address?.deepLink ?? "")}${lines}${columns}`;
}

function pathFromActivity(event: ActivityEvent) {
  return pathFromDeepLink(event.address?.deepLink);
}

function worldToScreen(point: Point) {
  return worldToScreenPoint(point, state.view, viewportSize());
}

function screenToWorld(point: Point) {
  return screenToWorldPoint(point, state.view, viewportSize());
}

function screenBounds(bounds: Bounds) {
  return screenBoundsForView(bounds, state.view, viewportSize());
}

function screenPoint(event: MouseEvent | PointerEvent | WheelEvent) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: clamp(event.clientX - rect.left, 0, rect.width),
    y: clamp(event.clientY - rect.top, 0, rect.height),
  };
}

function visible(box: Bounds) {
  return isScreenBoxVisible(box, viewportSize());
}

function screenIntersection(box: Bounds): Bounds | null {
  const x1 = Math.max(0, box.x);
  const y1 = Math.max(0, box.y);
  const x2 = Math.min(canvas.clientWidth, box.x + box.width);
  const y2 = Math.min(canvas.clientHeight, box.y + box.height);
  if (x2 <= x1 || y2 <= y1) {
    return null;
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function boundsCenter(bounds: Bounds) {
  return modelBoundsCenter(bounds);
}

function viewportSize() {
  return frameViewport ?? { width: canvas.clientWidth, height: canvas.clientHeight };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

async function fetchJson<T = unknown>(url: string): Promise<T> {
  return requestJson(url);
}

async function deleteJson<T = unknown>(url: string): Promise<T> {
  return requestJson(url, { method: "DELETE" });
}

async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  return requestJson(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function requestJson<T = unknown>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as T;
}

function requiredElement<T extends Element>(element: T | null, name: string): T {
  if (!element) {
    throw new Error(`Missing ${name}`);
  }
  return element;
}

function requiredContext<T>(context: T | null, name: string): T {
  if (!context) {
    throw new Error(`Missing ${name}`);
  }
  return context;
}
