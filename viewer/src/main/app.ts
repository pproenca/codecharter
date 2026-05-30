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
 *   - `controllers/search.ts`    — map search query → match → focus: feed the
 *                                  search form's query through the pure
 *                                  `mapSearchMatch`/`mapSearchAction` helpers and
 *                                  focus the matching place/file/folder (extracted;
 *                                  DI over the shared map/named-places state +
 *                                  app-owned camera/selection callbacks + the
 *                                  editing controller). It owns no identity; the
 *                                  shell wires searchForm submit → handleSubmit.
 *   - `controllers/activity-submit.ts` — activity write lifecycle: the form-submit
 *                                  path (addActivity reads #activityForm FormData,
 *                                  POSTs, then schedules refreshActivity) and the
 *                                  destructive clearActivityHistory (DELETE + reset
 *                                  of activity/signature/version/detail, fog rebuild,
 *                                  conditional selected-target null-out). The
 *                                  semantic activity state stays here in `state` and
 *                                  is reached through injected setters; activity-
 *                                  gesture's clearActivityHistory callback points at
 *                                  this controller. The shell wires activityForm
 *                                  submit → activitySubmit.addActivity.
 *   - `controllers/inspection.ts` — target inspection + source panel: selecting/
 *                                  inspecting a map target (folder/file/activity)
 *                                  and driving the inspector + source panel
 *                                  (handleMapTargetSelectionAction, clearMapSelection,
 *                                  inspectMapTarget/Folder/File, selectActivityEvent,
 *                                  fetchSourceContext, sourcePanelLineRange).
 *                                  Extracted; DI over the selected-target/map state +
 *                                  app-owned UI callbacks + the editing controller. It
 *                                  owns no identity; the selected target stays here in
 *                                  `state`. `routing` and `input` call into this
 *                                  controller (fetchSourceContext / the select-and-
 *                                  inspect dispatch) instead of app.ts shims. The pure
 *                                  `activityPathLabel` helper now lives in
 *                                  `render/activity.ts` and is imported directly by
 *                                  both this controller and the activity feed.
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
 *   - `controllers/input.ts`     — all DOM pointer + keyboard event handling plus
 *                                  the hit-test dispatch (wheel/keydown/keyup,
 *                                  pointer down/move/up/cancel, double-click, and
 *                                  hitTest → selectMapTarget). Wired LAST so it
 *                                  injects and calls the camera / interaction /
 *                                  selection / editing / inspection controllers
 *                                  rather than re-implementing them. The semantic
 *                                  drag/selection/target state stays here in
 *                                  `state`, reached through injected accessors;
 *                                  only the pending touch-space-pan timer is
 *                                  private to that factory. The shell wires
 *                                  document/canvas/mapArea events → `input.*` in
 *                                  `bindEvents`.
 */

import { createActivityGestureController } from "./controllers/activity-gesture.ts";
import { createActivitySubmitController } from "./controllers/activity-submit.ts";
import { createCameraController } from "./controllers/camera.ts";
import { createEditingController } from "./controllers/editing.ts";
import { createInputController } from "./controllers/input.ts";
import { createInspectionController } from "./controllers/inspection.ts";
import { createInteractionController } from "./controllers/interaction.ts";
import { activitySignature, createPollingController } from "./controllers/polling.ts";
import { createRoutingController } from "./controllers/routing.ts";
import { createSearchController } from "./controllers/search.ts";
import { createSelectionOverlayController } from "./controllers/selection-overlay.ts";
import { createSelectionController } from "./controllers/selection.ts";
import { createAnnotationHashRoute, createSelectionHashRoute } from "./deep-links.ts";
// Edit this source, then run `pnpm build:public` to regenerate public/app.js.
import {
  buildActivityFogState,
  createActivityDrawer,
  createDrawController,
  createFogDrawer,
  hashString,
  isScreenBoxVisible,
  labelBoxesOverlap,
  organicRegionFolders,
  reconciledSelectedTarget,
  screenBoundsForView,
  screenToWorldPoint,
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
  NamedPlace,
  Point,
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
type TimerHandle = number | ReturnType<typeof setTimeout> | null;
type AnnotationHit = NamedPlace & { targetType: "annotation" };
type ActivityHit = ActivityEvent & { targetType: "activity" };
type HitTarget = TargetHit | AnnotationHit | ActivityHit;
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
const search = createSearchController({
  getMap: () => state.map,
  getNamedPlaces: () => state.namedPlaces,
  setSelectedTarget: (target) => {
    state.selectedTarget = target;
  },
  controls,
  zoomToBounds,
  zoomToReadableFile: (file) => zoomToReadableFile(file),
  selectMapTarget: (point) => input.selectMapTarget(point),
  render,
  setText,
  editing: {
    selectedAnnotation: () => editing.selectedAnnotation(),
    selectAnnotation: (annotation) => editing.selectAnnotation(annotation),
  },
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
  fetchSourceContext: (sourceContext) => inspection.fetchSourceContext(sourceContext),
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
const inspection = createInspectionController({
  getMap: () => state.map,
  setSelectedTarget: (target) => {
    state.selectedTarget = target;
  },
  controls,
  setText,
  render,
  applySourcePanel,
  fetchJson,
  viewportSize,
  canvasClientHeight: () => canvas.clientHeight,
  screenBounds,
  zoomToBounds,
  zoomToReadableFile,
  lineRatioForLine,
  updateSelectionPopover,
  syncHashRoute: (hash) => routing.syncHashRoute(hash),
  editing: {
    clearPendingDelete: () => editing.clearPendingDelete(),
    clearAnnotationForm: () => editing.clearAnnotationForm(),
    selectAnnotation: (annotation) => editing.selectAnnotation(annotation),
  },
});
const input = createInputController({
  getDrawing: () => state.drawing,
  getPanning: () => state.panning,
  getSpacePanning: () => state.spacePanning,
  getDragging: () => state.dragging,
  setDragging: (drag) => {
    state.dragging = drag;
  },
  getSelectedTarget: () => state.selectedTarget,
  setSelectedTarget: (target) => {
    state.selectedTarget = target;
  },
  getEditingAnnotation: () => state.editingAnnotation,
  setEditingAnnotation: (annotation) => {
    state.editingAnnotation = annotation;
  },
  getDraftSelection: () => state.draftSelection,
  setDraftSelection: (draft) => {
    state.draftSelection = draft;
  },
  getResolvedSelection: () => state.resolvedSelection,
  getView: () => state.view,
  setView: (view) => {
    state.view = view;
  },
  getLastPointerDown: () => state.lastPointerDown,
  setLastPointerDown: (value) => {
    state.lastPointerDown = value;
  },
  setLastPointerType: (value) => {
    state.lastPointerType = value;
  },
  getPendingClickSelection: () => state.pendingClickSelection,
  setPendingClickSelection: (value) => {
    state.pendingClickSelection = value;
  },
  getMapFiles: () => state.mapFiles,
  getMapFolders: () => state.mapFolders,
  getNamedPlaces: () => state.namedPlaces,
  getActivity: () => state.activity,
  canvas,
  controls,
  cancelCameraAnimation,
  animateViewTo,
  fitCodebaseView,
  zoomToBounds,
  requestRender,
  render,
  resetSelectionOverlay,
  clearDraftSelection,
  updateSelectionPopover,
  setSelectionStatus,
  setText,
  screenPoint,
  screenToWorld,
  viewportSize,
  activityDiscoveryEnabled,
  camera,
  interaction,
  selection,
  editing: {
    selectAnnotation: (annotation) => editing.selectAnnotation(annotation),
    saveSelection: () => editing.saveSelection(),
    copySelectedAnnotationPrompt: () => editing.copySelectedAnnotationPrompt(),
    deleteSelectedAnnotation: () => editing.deleteSelectedAnnotation(),
  },
  inspection: {
    handleMapTargetSelectionAction: (action, hit, worldPoint) =>
      inspection.handleMapTargetSelectionAction(action, hit, worldPoint),
    inspectFileTarget: (hit, worldPoint, options) =>
      inspection.inspectFileTarget(hit, worldPoint, options),
    selectActivityEvent: (event, options) => inspection.selectActivityEvent(event, options),
  },
});
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
const activitySubmit = createActivitySubmitController({
  activityForm: controls.activityForm instanceof HTMLFormElement ? controls.activityForm : null,
  clearActivityTool: controls.clearActivityTool,
  setActivity: (events) => {
    state.activity = events;
  },
  setActivitySignature: (sig) => {
    state.activitySignature = sig;
  },
  setActivityVersion: (version) => {
    state.activityVersion = version;
  },
  setActivityDetail: (detail) => {
    state.activityDetail = detail;
  },
  getSelectedTarget: () => state.selectedTarget,
  setSelectedTarget: (target) => {
    state.selectedTarget = target;
  },
  rebuildActivityFog,
  setHoverText: (text) => setText(controls.hover, text),
  render,
  postJson,
  deleteJson,
  refreshActivity: polling.refreshActivity,
});
const activityGesture = createActivityGestureController({
  clearActivityTool: controls.clearActivityTool,
  setHoverText: (text) => setText(controls.hover, text),
  clearActivityHistory: activitySubmit.clearActivityHistory,
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
  getOverlaps: () => state.overlaps,
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
    void inspection.selectActivityEvent(event);
  },
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
  document.addEventListener("keydown", input.onDocumentKeyDown);
  document.addEventListener("keyup", input.onDocumentKeyUp);
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

  controls.searchForm?.addEventListener("submit", (event) => search.handleSubmit(event));
  controls.saveSelection?.addEventListener("click", () => editing.saveSelection());
  controls.deleteAnnotation?.addEventListener("click", () => editing.deleteSelectedAnnotation());
  controls.copyAnnotationPrompt?.addEventListener("click", () =>
    editing.copySelectedAnnotationPrompt(),
  );
  controls.editAnnotation?.addEventListener("click", () => editing.editSelectedAnnotation());
  controls.deleteAnnotationAction?.addEventListener("click", () =>
    editing.deleteSelectedAnnotation(),
  );
  controls.activityForm?.addEventListener("submit", activitySubmit.addActivity);
  activityGesture.bindClearActivityHold();

  mapArea.addEventListener("wheel", input.onWheel, { passive: false });
  canvas.addEventListener("pointerdown", input.onPointerDown);
  canvas.addEventListener("pointermove", input.onPointerMove);
  canvas.addEventListener("pointerup", input.onPointerUp);
  canvas.addEventListener("pointerleave", input.onPointerUp);
  canvas.addEventListener("lostpointercapture", input.onPointerUp);
  canvas.addEventListener("pointercancel", input.onPointerCancel);
  canvas.addEventListener("dblclick", input.onCanvasDoubleClick);
  canvas.addEventListener("blur", () => canvas.classList.remove("pointer-focused"));
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "application");
  canvas.setAttribute(
    "aria-label",
    "CodeCharter map canvas. Use the pointer tool to select items, the hand tool or Space drag to pan, arrow keys to pan, plus and minus to zoom, double click to zoom in, 0 to fit the codebase, Enter to select the center, and Escape to cancel the current action.",
  );
  canvas.addEventListener("keydown", input.onCanvasKeyDown);
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
      draw.drawOverlaps();
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

function lineRatioForLine(file: MapFile, line: number) {
  return (line - 0.5) / Math.max(1, file.lineCount ?? 0);
}

function setText(element: HTMLElement | null, value: string) {
  if (element) {
    element.textContent = value;
  }
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
