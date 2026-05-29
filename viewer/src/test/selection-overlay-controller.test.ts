import assert from "node:assert/strict";
import test from "node:test";
import {
  type SelectionOverlayControllerDeps,
  createSelectionOverlayController,
} from "../main/controllers/selection-overlay.ts";
import type { Bounds, MapAnnotationPlace, NamedPlace } from "../main/render/types.ts";

type FakeControl = {
  hidden: boolean;
  disabled: boolean;
  value: string;
  textContent: string;
  offsetHeight: number;
  style: {
    set: Map<string, string>;
    width: string;
    bottom: string;
    left: string;
    top: string;
    setProperty(name: string, value: string): void;
    removeProperty(name: string): void;
  };
  attributes: Map<string, string>;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
};

// A minimal stand-in for the controls the overlay touches. Only the property
// surface the controller reads/writes is modeled — the real DOM is irrelevant
// to the popover visibility + positioning logic.
function fakeControl(): FakeControl {
  const setProps = new Map<string, string>();
  const attributes = new Map<string, string>();
  return {
    hidden: false,
    disabled: false,
    value: "",
    textContent: "",
    offsetHeight: 100,
    style: {
      set: setProps,
      width: "",
      bottom: "",
      left: "",
      top: "",
      setProperty(name, value) {
        setProps.set(name, value);
      },
      removeProperty(name) {
        setProps.delete(name);
      },
    },
    attributes,
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
  };
}

type Recorder = {
  saveLabels: (string | undefined)[];
  statuses: string[];
  pendingDeleteCleared: number;
  interactionModeSyncs: number;
};

type ControlName =
  | "selectionPopover"
  | "annotationActions"
  | "deleteAnnotation"
  | "selectionContext"
  | "annotationTitle"
  | "annotationMeta"
  | "saveSelection"
  | "selectionComment";

type FakeControls = Record<ControlName, FakeControl>;

type Harness = {
  deps: SelectionOverlayControllerDeps;
  controls: FakeControls;
  state: SelectionOverlayControllerDeps["state"];
  recorder: Recorder;
  selectedAnnotation: { current: MapAnnotationPlace | null };
};

function harness(): Harness {
  const controls: FakeControls = {
    selectionPopover: fakeControl(),
    annotationActions: fakeControl(),
    deleteAnnotation: fakeControl(),
    selectionContext: fakeControl(),
    annotationTitle: fakeControl(),
    annotationMeta: fakeControl(),
    saveSelection: fakeControl(),
    selectionComment: fakeControl(),
  };
  const state: SelectionOverlayControllerDeps["state"] = {
    dragging: { type: "select" },
    drawing: true,
    panning: false,
    draftSelection: { type: "rect", bounds: { x: 0, y: 0, width: 4, height: 4 } },
    resolvedSelection: null,
    editingAnnotation: null,
    namedPlaces: [],
    namedPlacesById: new Map(),
    namedPlaceIndexesById: new Map(),
  };
  const recorder: Recorder = {
    saveLabels: [],
    statuses: [],
    pendingDeleteCleared: 0,
    interactionModeSyncs: 0,
  };
  const selectedAnnotation: { current: MapAnnotationPlace | null } = { current: null };
  const deps: SelectionOverlayControllerDeps = {
    state,
    controls: controls as unknown as SelectionOverlayControllerDeps["controls"],
    defaultMapLevel: "file",
    saveAndCopyLabel: "Save & Copy Prompt",
    copyPromptLabel: "Copy Prompt",
    getAnnotationTitle: (annotation) => annotation?.name ?? "Map annotation",
    getSelectedAnnotation: () => selectedAnnotation.current,
    clearEditingPendingDelete: () => {
      recorder.pendingDeleteCleared += 1;
    },
    updateInteractionModeUi: () => {
      recorder.interactionModeSyncs += 1;
    },
    setSaveButtonLabel: (label) => {
      recorder.saveLabels.push(label);
    },
    setSelectionStatus: (message) => {
      recorder.statuses.push(message);
    },
    screenBounds: (bounds: Bounds) => bounds,
    canvasSize: () => ({ clientWidth: 800, clientHeight: 600 }),
  };
  return { deps, controls, state, recorder, selectedAnnotation };
}

test("createSelectionOverlayController exposes the wiring surface app.ts consumes", () => {
  const controller = createSelectionOverlayController(harness().deps);
  assert.equal(typeof controller.updateSelectionPopover, "function");
  assert.equal(typeof controller.positionAnnotationActions, "function");
  assert.equal(typeof controller.resetSelectionOverlay, "function");
  assert.equal(typeof controller.clearDraftSelection, "function");
  assert.equal(typeof controller.setNamedPlaces, "function");
});

test("setNamedPlaces rebuilds the by-id and index-by-id maps and skips id-less places", () => {
  const h = harness();
  const controller = createSelectionOverlayController(h.deps);
  const places: NamedPlace[] = [{ id: "a", name: "A" }, { name: "no-id" }, { id: "b", name: "B" }];
  controller.setNamedPlaces(places);
  assert.equal(h.state.namedPlaces, places);
  assert.deepEqual([...h.state.namedPlacesById.keys()], ["a", "b"]);
  assert.equal(h.state.namedPlacesById.get("b")?.name, "B");
  assert.equal(h.state.namedPlaceIndexesById.get("a"), 0);
  assert.equal(h.state.namedPlaceIndexesById.get("b"), 2);
});

test("clearDraftSelection clears draft/resolved/editing, disables save, and clears pending delete", () => {
  const h = harness();
  h.state.resolvedSelection = { geometry: { bounds: { x: 0, y: 0, width: 1, height: 1 } } };
  h.state.editingAnnotation = { id: "x", name: "x" };
  h.controls.saveSelection.disabled = false;
  const controller = createSelectionOverlayController(h.deps);
  controller.clearDraftSelection();
  assert.equal(h.state.dragging, null);
  assert.equal(h.state.draftSelection, null);
  assert.equal(h.state.resolvedSelection, null);
  assert.equal(h.state.editingAnnotation, null);
  assert.equal(h.controls.saveSelection.disabled, true);
  assert.equal(h.recorder.pendingDeleteCleared, 1);
  // updateSelectionPopover ran as part of clearing (popover hidden, no draft/editing).
  assert.equal(h.controls.selectionPopover.hidden, true);
});

test("resetSelectionOverlay restores pan mode, clears the comment, hides delete, and syncs UI", () => {
  const h = harness();
  h.state.editingAnnotation = { id: "x", name: "x" };
  h.controls.selectionComment.value = "draft comment";
  h.controls.deleteAnnotation.hidden = false;
  const controller = createSelectionOverlayController(h.deps);
  controller.resetSelectionOverlay();
  assert.equal(h.state.drawing, false);
  assert.equal(h.state.panning, true);
  assert.equal(h.state.draftSelection, null);
  assert.equal(h.state.editingAnnotation, null);
  assert.equal(h.controls.selectionComment.value, "");
  assert.equal(h.controls.deleteAnnotation.hidden, true);
  assert.equal(h.recorder.interactionModeSyncs, 1);
  assert.deepEqual(h.recorder.statuses, [""]);
});

test("updateSelectionPopover shows the popover for a resolved selection and labels save", () => {
  const h = harness();
  h.state.draftSelection = null;
  h.state.resolvedSelection = {
    level: "file",
    geometry: { bounds: { x: 0, y: 0, width: 1, height: 1 } },
    resolvedTargets: [{}, {}],
    coveringSet: ["u4pru"],
  };
  const controller = createSelectionOverlayController(h.deps);
  controller.updateSelectionPopover();
  assert.equal(h.controls.selectionPopover.hidden, false);
  assert.equal(h.controls.saveSelection.disabled, false);
  assert.equal(h.controls.selectionContext.textContent, "2 files · file level · u4pru");
  assert.equal(h.recorder.saveLabels.at(-1), "Save & Copy Prompt");
});

test("updateSelectionPopover labels save as Copy Prompt while editing an annotation", () => {
  const h = harness();
  h.state.draftSelection = null;
  h.state.resolvedSelection = null;
  h.state.editingAnnotation = { id: "x", name: "x", level: "file" };
  const controller = createSelectionOverlayController(h.deps);
  controller.updateSelectionPopover();
  assert.equal(h.controls.selectionPopover.hidden, false);
  assert.equal(h.controls.deleteAnnotation.hidden, false);
  assert.equal(h.controls.saveSelection.disabled, false);
  assert.equal(h.recorder.saveLabels.at(-1), "Copy Prompt");
});

test("positionAnnotationActions places the panel below the target and points at its center", () => {
  const h = harness();
  const controller = createSelectionOverlayController(h.deps);
  const annotation: MapAnnotationPlace = {
    id: "a",
    name: "A",
    geometry: { bounds: { x: 100, y: 100, width: 40, height: 20 } },
  };
  controller.positionAnnotationActions(annotation, { visible: true });
  const panel = h.controls.annotationActions;
  // panel width = min(360, max(260, 800 - 32)) = 360; left clamps to >= margin 16.
  assert.equal(panel.style.width, "360px");
  assert.equal(panel.style.left, "16px");
  assert.equal(panel.attributes.get("data-placement"), "below");
  // belowTop = y + height + gap = 100 + 20 + 12 = 132.
  assert.equal(panel.style.top, "132px");
  assert.ok(panel.style.set.has("--annotation-pointer-x"));
});

test("positionAnnotationActions clears positioning props when not visible", () => {
  const h = harness();
  const controller = createSelectionOverlayController(h.deps);
  const panel = h.controls.annotationActions;
  panel.style.left = "50px";
  panel.attributes.set("data-placement", "below");
  controller.positionAnnotationActions(null, { visible: false });
  assert.equal(panel.style.set.has("--annotation-pointer-x"), false);
  assert.equal(panel.attributes.has("data-placement"), false);
});
