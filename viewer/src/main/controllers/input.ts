/**
 * Input controller: all DOM pointer + keyboard event handling plus the hit-test
 * dispatch that turns a world point into a selectable map target. This is the
 * most coupled cluster, so it is wired LAST — it injects and calls the already-
 * constructed camera / interaction / selection / editing / inspection controllers
 * rather than re-implementing their behavior. The semantic state (dragging,
 * draft/resolved selection, selected target, editing annotation, the view, the
 * map/file/folder/named-place/activity lists) stays in app `state`; this module
 * reaches it through injected getters/setters and owns no second identity model.
 *
 * The only state private to this factory is the pending touch-space-pan timer —
 * the pending click-selection timer lives in app `state` (it is part of the
 * MapApplicationState struct) and is reached through injected accessors. Pure
 * keyboard-action mapping, hover labels, hit-tests, and drag/pan math are
 * imported directly from `render/*` (unit-tested there); the cross-tool Deep
 * Link route is written through the routing controller via the callbacks the
 * inspection controller already owns.
 */

import { parseHashRoute } from "../deep-links.ts";
import {
  canvasKeyboardAction,
  documentKeyboardAction,
  doubleClickMapAction,
  hitTestActivityEvents,
  hitTestAnnotations,
  hitTestTargetLists,
  isSpaceKeyEvent,
  KEYBOARD_ZOOM_FACTOR,
  mapHoverLabel,
  mapTargetSelectionAction,
  panViewByScreenDelta,
  panViewForDrag,
} from "../render/index.ts";
import type {
  ActivityEvent,
  Bounds,
  MapActionOf,
  MapAnnotationPlace,
  MapFile,
  MapFolder,
  NamedPlace,
  Point,
  TargetHit,
  View,
  Viewport,
} from "../render/index.ts";

type AnnotationHit = NamedPlace & { targetType: "annotation" };
type ActivityHit = ActivityEvent & { targetType: "activity" };
type HitTarget = TargetHit | AnnotationHit | ActivityHit;
type CanvasAction = NonNullable<ReturnType<typeof canvasKeyboardAction>>;
type DocumentAction = NonNullable<ReturnType<typeof documentKeyboardAction>>;
type DoubleClickAction = MapActionOf<
  "focusAnnotation" | "selectFolder" | "selectFile" | "selectActivity"
>;
type TimerHandle = number | ReturnType<typeof setTimeout> | null;
type MapDrag =
  | { type: "draw"; start: Point; current: Point }
  | { type: "pan"; start: Point; view: View; transient?: boolean }
  | { type: "select"; start: Point; world: Point };
type PointerDownState = { screen: Point; world: Point };

const DOUBLE_CLICK_ZOOM_FACTOR = 2;
const CLICK_SELECT_DELAY_MS = 220;
const TOUCH_SPACE_PAN_HOLD_MS = 220;

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

type InputControls = {
  hover: HTMLElement | null;
  selectionComment: { value?: string } | null;
};

export type InputControllerDeps = {
  // --- state getters/setters (the shared semantic state stays in app.ts) ---
  getDrawing: () => boolean;
  getPanning: () => boolean;
  getSpacePanning: () => boolean;
  getDragging: () => MapDrag | null;
  setDragging: (drag: MapDrag | null) => void;
  getSelectedTarget: () => HitTarget | null;
  setSelectedTarget: (target: HitTarget | null) => void;
  getEditingAnnotation: () => AnnotationHit | null;
  setEditingAnnotation: (annotation: null) => void;
  getDraftSelection: () => { type: "rect"; bounds: Bounds } | null;
  setDraftSelection: (draft: { type: "rect"; bounds: Bounds } | null) => void;
  getResolvedSelection: () => unknown;
  getView: () => View;
  setView: (view: View) => void;
  getLastPointerDown: () => PointerDownState | null;
  setLastPointerDown: (value: PointerDownState | null) => void;
  setLastPointerType: (value: string) => void;
  getPendingClickSelection: () => TimerHandle;
  setPendingClickSelection: (value: TimerHandle) => void;
  getMapFiles: () => MapFile[];
  getMapFolders: () => MapFolder[];
  getNamedPlaces: () => NamedPlace[];
  getActivity: () => ActivityEvent[];

  // --- DOM ---
  canvas: HTMLCanvasElement;
  controls: InputControls;

  // --- app-owned callbacks (stay in app.ts, injected) ---
  cancelCameraAnimation: () => void;
  animateViewTo: (view: View) => void;
  fitCodebaseView: (options?: { animate?: boolean }) => void;
  zoomToBounds: (bounds: Bounds, paddingFactor?: number) => void;
  requestRender: () => void;
  render: () => void;
  resetSelectionOverlay: () => void;
  clearDraftSelection: () => void;
  updateSelectionPopover: () => void;
  setSelectionStatus: (message: string) => void;
  setText: (element: HTMLElement | null, value: string) => void;
  screenPoint: (event: MouseEvent | PointerEvent | WheelEvent) => Point;
  screenToWorld: (point: Point) => Point;
  viewportSize: () => Viewport;
  activityDiscoveryEnabled: () => boolean;

  // --- cross-controller calls (already-constructed controllers, injected) ---
  camera: {
    viewportCenter: () => Point;
    wheelZoomFactor: (event: WheelEvent) => number;
    zoomAt: (screenAnchor: Point, factor: number, options?: { animate?: boolean }) => void;
    panByWheel: (event: WheelEvent) => void;
  };
  interaction: {
    setSpacePanMode: (enabled: boolean) => void;
    updateInteractionModeUi: () => void;
  };
  selection: {
    updateDraft: (world: Point) => void;
    hasUsableDraft: () => boolean;
    preview: () => Promise<void>;
  };
  editing: {
    selectAnnotation: (annotation: MapAnnotationPlace) => void;
    // Return values are discarded at the await sites; widen to unknown so the
    // controller's real Promise<boolean | void> returns assign cleanly.
    saveSelection: () => Promise<unknown>;
    copySelectedAnnotationPrompt: () => Promise<unknown>;
    deleteSelectedAnnotation: () => Promise<unknown>;
  };
  inspection: {
    handleMapTargetSelectionAction: (
      action: ReturnType<typeof mapTargetSelectionAction>,
      hit: HitTarget | null,
      worldPoint: Point,
    ) => Promise<void>;
    inspectFileTarget: (
      hit: MapFile & { targetType: "file" },
      worldPoint: Point,
      options?: { zoomReadable?: boolean },
    ) => Promise<void>;
    selectActivityEvent: (
      event: ActivityEvent,
      options?: { zoomReadable?: boolean },
    ) => Promise<void>;
  };
};

export type InputController = ReturnType<typeof createInputController>;

export function createInputController(deps: InputControllerDeps) {
  let pendingTouchSpacePan: TimerHandle = null;

  function onWheel(event: WheelEvent) {
    event.preventDefault();
    deps.cancelCameraAnimation();
    const mouse = deps.screenPoint(event);
    if (event.ctrlKey || event.metaKey) {
      deps.camera.zoomAt(mouse, deps.camera.wheelZoomFactor(event));
    } else {
      deps.camera.panByWheel(event);
    }
    deps.requestRender();
  }

  function onCanvasKeyDown(event: KeyboardEvent) {
    deps.canvas.classList.remove("pointer-focused");
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
      hasResolvedSelection: deps.getResolvedSelection() !== null,
      hasSelectedAnnotation: deps.getSelectedTarget()?.targetType === "annotation",
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
        deps.animateViewTo(panViewByScreenDelta(deps.getView(), action.delta, deps.viewportSize()));
        return;
      case "zoomIn":
        deps.camera.zoomAt(deps.camera.viewportCenter(), KEYBOARD_ZOOM_FACTOR, { animate: true });
        return;
      case "zoomOut":
        deps.camera.zoomAt(deps.camera.viewportCenter(), 1 / KEYBOARD_ZOOM_FACTOR, {
          animate: true,
        });
        return;
      case "fitCodebase":
        deps.fitCodebaseView({ animate: true });
        return;
      case "selectCenter":
        await selectMapTarget(deps.screenToWorld(deps.camera.viewportCenter()));
    }
  }

  async function handleDocumentKeyboardAction(action: DocumentAction): Promise<void> {
    switch (action.type) {
      case "startSpacePan":
        deps.interaction.setSpacePanMode(true);
        return;
      case "cancelInteraction":
        cancelCurrentInteraction();
        return;
      case "saveSelection":
        await deps.editing.saveSelection();
        return;
      case "copyAnnotationPrompt":
        await deps.editing.copySelectedAnnotationPrompt();
        return;
      case "deleteAnnotation":
        await deps.editing.deleteSelectedAnnotation();
    }
  }

  function onDocumentKeyUp(event: KeyboardEvent) {
    if (isSpaceKeyEvent(event) && deps.getSpacePanning()) {
      event.preventDefault();
      deps.interaction.setSpacePanMode(false);
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
    if (deps.getEditingAnnotation()) {
      deps.setEditingAnnotation(null);
      if (deps.controls.selectionComment) {
        deps.controls.selectionComment.value = "";
      }
      deps.updateSelectionPopover();
      deps.setSelectionStatus("Edit cancelled.");
      deps.render();
      deps.canvas.focus({ preventScroll: true });
      return;
    }

    if (
      deps.getDragging() ||
      deps.getDraftSelection() ||
      deps.getResolvedSelection() ||
      deps.getDrawing()
    ) {
      deps.resetSelectionOverlay();
      clearSelectionHashRoute();
      deps.setSelectionStatus("Selection cancelled.");
      deps.render();
      deps.canvas.focus({ preventScroll: true });
      return;
    }

    if (deps.getSelectedTarget()) {
      deps.setSelectedTarget(null);
      if (deps.controls.selectionComment) {
        deps.controls.selectionComment.value = "";
      }
      deps.updateSelectionPopover();
      clearSelectionHashRoute();
      deps.setSelectionStatus("Selection cleared.");
      deps.render();
      deps.canvas.focus({ preventScroll: true });
    }
  }

  function clearSelectionHashRoute() {
    if (parseHashRoute(window.location.hash)?.type === "selection") {
      window.history.replaceState(null, "", "#");
    }
  }

  function onPointerDown(event: PointerEvent) {
    deps.cancelCameraAnimation();
    cancelPendingTouchSpacePan();
    if (deps.getDragging()?.type !== "select") {
      cancelPendingClickSelection();
    }
    deps.canvas.classList.add("pointer-focused");
    try {
      deps.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events and some interrupted touch streams have no active pointer to capture.
    }
    deps.canvas.focus({ preventScroll: true });
    const screen = deps.screenPoint(event);
    const point = deps.screenToWorld(screen);
    const spacePan = isSpacePanPointerEvent(event);
    deps.setLastPointerDown({ screen, world: point });
    deps.setLastPointerType(event.pointerType);
    if (deps.getDrawing() && !spacePan) {
      deps.setSelectedTarget(null);
      deps.setDragging({ type: "draw", start: point, current: point });
      deps.setDraftSelection({
        type: "rect",
        bounds: { x: point.x, y: point.y, width: 0, height: 0 },
      });
      deps.render();
    } else if (deps.getPanning() || spacePan) {
      deps.setDragging({
        type: "pan",
        start: deps.screenPoint(event),
        view: { ...deps.getView() },
        transient: spacePan,
      });
    } else {
      deps.setDragging({ type: "select", start: screen, world: point });
      scheduleTouchSpacePan(event);
    }
    deps.interaction.updateInteractionModeUi();
  }

  function isSpacePanPointerEvent(event: PointerEvent) {
    return deps.getSpacePanning() || event.getModifierState?.("Space") === true;
  }

  function scheduleTouchSpacePan(event: PointerEvent) {
    if (event.pointerType !== "touch") {
      return;
    }
    pendingTouchSpacePan = window.setTimeout(() => {
      pendingTouchSpacePan = null;
      const lastPointerDown = deps.getLastPointerDown();
      if (deps.getDragging()?.type !== "select" || !lastPointerDown) {
        return;
      }
      deps.interaction.setSpacePanMode(true);
      deps.setDragging({
        type: "pan",
        start: lastPointerDown.screen,
        view: { ...deps.getView() },
        transient: true,
      });
      deps.interaction.updateInteractionModeUi();
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
    const screen = deps.screenPoint(event);
    const world = deps.screenToWorld(screen);
    const dragging = deps.getDragging();
    const lastPointerDown = deps.getLastPointerDown();
    if (dragging?.type === "select" && lastPointerDown) {
      const moved = Math.hypot(
        screen.x - lastPointerDown.screen.x,
        screen.y - lastPointerDown.screen.y,
      );
      if (moved > 4) {
        cancelPendingTouchSpacePan();
      }
    }
    const hit = hitTest(world);
    deps.setText(
      deps.controls.hover,
      hit ? mapHoverLabel(hit) : `x ${world.x.toFixed(4)}, y ${world.y.toFixed(4)}`,
    );

    if (!dragging) {
      return;
    }
    if (dragging.type === "select") {
      return;
    }
    if (dragging.type === "pan") {
      deps.setView(panViewForDrag(dragging, screen, deps.viewportSize()));
    } else {
      deps.selection.updateDraft(world);
    }
    deps.requestRender();
  }

  async function onPointerUp(event: PointerEvent) {
    cancelPendingTouchSpacePan();
    const dragging = deps.getDragging();
    const endTouchSpacePan =
      dragging?.type === "pan" && dragging.transient && event.pointerType === "touch";
    if (dragging?.type === "draw" && deps.getDraftSelection()) {
      if (event.type !== "lostpointercapture") {
        deps.selection.updateDraft(deps.screenToWorld(deps.screenPoint(event)));
      }
      if (!deps.selection.hasUsableDraft()) {
        deps.clearDraftSelection();
        deps.render();
        return;
      }
      deps.setDragging(null);
      deps.interaction.updateInteractionModeUi();
      await deps.selection.preview();
      return;
    }

    const lastPointerDown = deps.getLastPointerDown();
    if (dragging?.type === "select" && lastPointerDown) {
      const current = deps.screenPoint(event);
      const moved = Math.hypot(
        current.x - lastPointerDown.screen.x,
        current.y - lastPointerDown.screen.y,
      );
      if (moved < 4) {
        scheduleClickSelection(lastPointerDown.world);
      }
    }
    deps.setDragging(null);
    if (endTouchSpacePan) {
      deps.interaction.setSpacePanMode(false);
    }
    deps.interaction.updateInteractionModeUi();
  }

  function onPointerCancel(event?: PointerEvent) {
    cancelPendingTouchSpacePan();
    const dragging = deps.getDragging();
    const endTouchSpacePan =
      dragging?.type === "pan" && dragging.transient && event?.pointerType === "touch";
    deps.setDragging(null);
    if (endTouchSpacePan) {
      deps.interaction.setSpacePanMode(false);
    }
    deps.interaction.updateInteractionModeUi();
  }

  function onCanvasDoubleClick(event: MouseEvent) {
    if (deps.getDrawing()) {
      return;
    }
    event.preventDefault();
    cancelPendingClickSelection();
    const screen = deps.screenPoint(event);
    const world = deps.screenToWorld(screen);
    const hit = hitTestDrillTarget(world) ?? hitTestAnnotation(world);
    const action = doubleClickMapAction(hit);

    if (action && hit) {
      void handleDoubleClickAction(action, hit, world);
      return;
    }

    deps.camera.zoomAt(screen, DOUBLE_CLICK_ZOOM_FACTOR, { animate: true });
  }

  function scheduleClickSelection(worldPoint: Point) {
    cancelPendingClickSelection();
    deps.setPendingClickSelection(
      window.setTimeout(() => {
        deps.setPendingClickSelection(null);
        void selectMapTarget(worldPoint);
      }, CLICK_SELECT_DELAY_MS),
    );
  }

  function cancelPendingClickSelection() {
    const pending = deps.getPendingClickSelection();
    if (!pending) {
      return;
    }
    window.clearTimeout(pending);
    deps.setPendingClickSelection(null);
  }

  function hitTestDrillTarget(world: Point) {
    return hitTestActivity(world) ?? hitTestMapTargets(world);
  }

  async function selectMapTarget(worldPoint: Point) {
    const hit = hitTest(worldPoint);
    const action = mapTargetSelectionAction(hit);
    await deps.inspection.handleMapTargetSelectionAction(action, hit, worldPoint);
  }

  async function handleDoubleClickAction(action: DoubleClickAction, hit: HitTarget, world: Point) {
    switch (action.type) {
      case "focusAnnotation":
        if (hit.targetType !== "annotation" || !hasGeometryBounds(hit)) {
          return;
        }
        deps.zoomToBounds(hit.geometry.bounds, 1.28);
        deps.editing.selectAnnotation(hit);
        return;
      case "selectFolder":
        void selectMapTarget(world);
        if (hit.targetType !== "folder" || !hasBounds(hit)) {
          return;
        }
        deps.zoomToBounds(hit.bounds, 1.35);
        return;
      case "selectFile":
        if (hit.targetType === "file") {
          await deps.inspection.inspectFileTarget(hit, world, { zoomReadable: true });
        }
        return;
      case "selectActivity":
        if (hit.targetType === "activity") {
          await deps.inspection.selectActivityEvent(hit, { zoomReadable: true });
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
    return hitTestTargetLists(deps.getMapFiles(), deps.getMapFolders(), point);
  }

  function hitTestAnnotation(point: Point) {
    const radiusX = 15 / (deps.canvas.clientWidth * deps.getView().scale);
    const radiusY = 15 / (deps.canvas.clientHeight * deps.getView().scale);
    return hitTestAnnotations(deps.getNamedPlaces(), point, { radiusX, radiusY });
  }

  function hitTestActivity(point: Point) {
    if (!deps.activityDiscoveryEnabled()) {
      return null;
    }
    const radiusX = 13 / (deps.canvas.clientWidth * deps.getView().scale);
    const radiusY = 13 / (deps.canvas.clientHeight * deps.getView().scale);
    return hitTestActivityEvents(deps.getActivity(), point, { radiusX, radiusY });
  }

  return {
    onWheel,
    onCanvasKeyDown,
    onDocumentKeyDown,
    onDocumentKeyUp,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onCanvasDoubleClick,
    selectMapTarget,
    cancelPendingClickSelection,
  };
}
