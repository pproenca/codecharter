import assert from "node:assert/strict";
import test from "node:test";
import { type InputControllerDeps, createInputController } from "../main/controllers/input.ts";
import type {
  ActivityEvent,
  Bounds,
  MapActionOf,
  MapFile,
  MapFolder,
  NamedPlace,
  Point,
  TargetHit,
  View,
} from "../main/render/types.ts";

type AnnotationHit = NamedPlace & { targetType: "annotation" };
type ActivityHit = ActivityEvent & { targetType: "activity" };
type HitTarget = TargetHit | AnnotationHit | ActivityHit;
type MapDrag =
  | { type: "draw"; start: Point; current: Point }
  | { type: "pan"; start: Point; view: View; transient?: boolean }
  | { type: "select"; start: Point; world: Point };

type Flags = {
  drawing: boolean;
  panning: boolean;
  spacePanning: boolean;
};

type Mutable = {
  dragging: MapDrag | null;
  selectedTarget: HitTarget | null;
  editingAnnotation: AnnotationHit | null;
  draftSelection: { type: "rect"; bounds: Bounds } | null;
  resolvedSelection: unknown;
  view: View;
  lastPointerDown: { screen: Point; world: Point } | null;
  lastPointerType: string;
  pendingClickSelection: number | ReturnType<typeof setTimeout> | null;
};

type Recorder = {
  renders: number;
  requestRenders: number;
  statuses: string[];
  hoverText: string[];
  spacePanModes: boolean[];
  selectMapTargetCalls: Point[];
  cancelCameraAnimations: number;
  resetOverlays: number;
  popoverUpdates: number;
  zoomAtCalls: Array<{ anchor: Point; factor: number }>;
};

// A minimal canvas: the input controller only exercises classList.toggle/
// add/remove, focus, setPointerCapture, and clientWidth/clientHeight. None of
// the real DOM behavior matters to the pointer/keyboard transitions.
function fakeCanvas(): HTMLCanvasElement {
  return {
    clientWidth: 800,
    clientHeight: 600,
    classList: {
      add() {},
      remove() {},
      toggle() {
        return false;
      },
    },
    focus() {},
    setPointerCapture() {},
  } as unknown as HTMLCanvasElement;
}

function harness(
  initialFlags: Partial<Flags> = {},
  initialState: Partial<Mutable> = {},
): {
  deps: InputControllerDeps;
  flags: Flags;
  mutable: Mutable;
  recorder: Recorder;
} {
  const flags: Flags = { drawing: false, panning: true, spacePanning: false, ...initialFlags };
  const mutable: Mutable = {
    dragging: null,
    selectedTarget: null,
    editingAnnotation: null,
    draftSelection: null,
    resolvedSelection: null,
    view: { x: 0, y: 0, scale: 1 },
    lastPointerDown: null,
    lastPointerType: "",
    pendingClickSelection: null,
    ...initialState,
  };
  const recorder: Recorder = {
    renders: 0,
    requestRenders: 0,
    statuses: [],
    hoverText: [],
    spacePanModes: [],
    selectMapTargetCalls: [],
    cancelCameraAnimations: 0,
    resetOverlays: 0,
    popoverUpdates: 0,
    zoomAtCalls: [],
  };
  const deps: InputControllerDeps = {
    getDrawing: () => flags.drawing,
    getPanning: () => flags.panning,
    getSpacePanning: () => flags.spacePanning,
    getDragging: () => mutable.dragging,
    setDragging: (drag) => {
      mutable.dragging = drag;
    },
    getSelectedTarget: () => mutable.selectedTarget,
    setSelectedTarget: (target) => {
      mutable.selectedTarget = target;
    },
    getEditingAnnotation: () => mutable.editingAnnotation,
    setEditingAnnotation: (annotation) => {
      mutable.editingAnnotation = annotation;
    },
    getDraftSelection: () => mutable.draftSelection,
    setDraftSelection: (draft) => {
      mutable.draftSelection = draft;
    },
    getResolvedSelection: () => mutable.resolvedSelection,
    getView: () => mutable.view,
    setView: (view) => {
      mutable.view = view;
    },
    getLastPointerDown: () => mutable.lastPointerDown,
    setLastPointerDown: (value) => {
      mutable.lastPointerDown = value;
    },
    setLastPointerType: (value) => {
      mutable.lastPointerType = value;
    },
    getPendingClickSelection: () => mutable.pendingClickSelection,
    setPendingClickSelection: (value) => {
      mutable.pendingClickSelection = value;
    },
    getMapFiles: () => [] as MapFile[],
    getMapFolders: () => [] as MapFolder[],
    getNamedPlaces: () => [] as NamedPlace[],
    getActivity: () => [] as ActivityEvent[],
    canvas: fakeCanvas(),
    controls: { hover: null, selectionComment: { value: "draft comment" } },
    cancelCameraAnimation: () => {
      recorder.cancelCameraAnimations += 1;
    },
    animateViewTo: () => {},
    fitCodebaseView: () => {},
    zoomToBounds: () => {},
    requestRender: () => {
      recorder.requestRenders += 1;
    },
    render: () => {
      recorder.renders += 1;
    },
    resetSelectionOverlay: () => {
      recorder.resetOverlays += 1;
    },
    clearDraftSelection: () => {
      mutable.draftSelection = null;
    },
    updateSelectionPopover: () => {
      recorder.popoverUpdates += 1;
    },
    setSelectionStatus: (message) => {
      recorder.statuses.push(message);
    },
    setText: (_element, value) => {
      recorder.hoverText.push(value);
    },
    screenPoint: (event) => ({ x: event.clientX, y: event.clientY }),
    screenToWorld: (point) => point,
    viewportSize: () => ({ width: 800, height: 600 }),
    activityDiscoveryEnabled: () => false,
    camera: {
      viewportCenter: () => ({ x: 400, y: 300 }),
      wheelZoomFactor: () => 1.1,
      zoomAt: (anchor, factor) => {
        recorder.zoomAtCalls.push({ anchor, factor });
      },
      panByWheel: () => {},
    },
    interaction: {
      setSpacePanMode: (enabled) => {
        recorder.spacePanModes.push(enabled);
        flags.spacePanning = enabled;
      },
      updateInteractionModeUi: () => {},
    },
    selection: {
      updateDraft: () => {},
      hasUsableDraft: () => false,
      preview: async () => {},
    },
    editing: {
      selectAnnotation: () => {},
      saveSelection: async () => {},
      copySelectedAnnotationPrompt: async () => {},
      deleteSelectedAnnotation: async () => {},
    },
    inspection: {
      handleMapTargetSelectionAction: async (
        _action: MapActionOf<
          "clearSelection" | "focusAnnotation" | "selectActivity" | "inspectFolder" | "inspectFile"
        >,
        _hit: HitTarget | null,
        worldPoint: Point,
      ) => {
        recorder.selectMapTargetCalls.push(worldPoint);
      },
      inspectFileTarget: async () => {},
      selectActivityEvent: async () => {},
    },
  };
  return { deps, flags, mutable, recorder };
}

test("createInputController exposes the wiring surface app.ts consumes", () => {
  const controller = createInputController(harness().deps);
  for (const name of [
    "onWheel",
    "onCanvasKeyDown",
    "onDocumentKeyDown",
    "onDocumentKeyUp",
    "onPointerDown",
    "onPointerMove",
    "onPointerUp",
    "onPointerCancel",
    "onCanvasDoubleClick",
    "selectMapTarget",
    "cancelPendingClickSelection",
  ] as const) {
    assert.equal(typeof controller[name], "function", `missing ${name}`);
  }
});

test("keyup with Space while space-panning ends space-pan mode", () => {
  const h = harness({ spacePanning: true });
  const controller = createInputController(h.deps);

  controller.onDocumentKeyUp({
    code: "Space",
    key: " ",
    preventDefault() {},
  } as unknown as KeyboardEvent);

  assert.deepEqual(h.recorder.spacePanModes, [false]);
});

test("selectMapTarget routes the hit (here: empty -> clearSelection) through inspection dispatch", async () => {
  const h = harness();
  const controller = createInputController(h.deps);

  await controller.selectMapTarget({ x: 7, y: 9 });

  assert.deepEqual(h.recorder.selectMapTargetCalls, [{ x: 7, y: 9 }]);
});

test("double-click with no hit target falls back to a zoom-in at the pointer", () => {
  const h = harness();
  const controller = createInputController(h.deps);

  controller.onCanvasDoubleClick({
    clientX: 120,
    clientY: 80,
    preventDefault() {},
  } as unknown as MouseEvent);

  assert.equal(h.recorder.zoomAtCalls.length, 1);
  assert.deepEqual(h.recorder.zoomAtCalls[0]?.anchor, { x: 120, y: 80 });
  assert.equal(h.recorder.zoomAtCalls[0]?.factor, 2);
});

test("onWheel with a zoom modifier zooms at the pointer and requests a render", () => {
  const h = harness();
  const controller = createInputController(h.deps);

  controller.onWheel({
    ctrlKey: true,
    clientX: 50,
    clientY: 60,
    deltaY: -100,
    deltaMode: 0,
    preventDefault() {},
  } as unknown as WheelEvent);

  assert.equal(h.recorder.cancelCameraAnimations, 1);
  assert.equal(h.recorder.zoomAtCalls.length, 1);
  assert.deepEqual(h.recorder.zoomAtCalls[0]?.anchor, { x: 50, y: 60 });
  assert.equal(h.recorder.requestRenders, 1);
});
