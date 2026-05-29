import assert from "node:assert/strict";
import test from "node:test";
import {
  type InteractionControllerDeps,
  createInteractionController,
} from "../main/controllers/interaction.ts";

type FlagName = "drawing" | "panning" | "spacePanning";

type Recorder = {
  selectedTargetCleared: number;
  editingAnnotationCleared: number;
  draftCleared: number;
  statuses: string[];
  popoverUpdates: number;
};

type Harness = {
  deps: InteractionControllerDeps;
  flags: Record<FlagName, boolean>;
  recorder: Recorder;
  canvasClasses: Map<string, boolean>;
};

// A minimal stand-in for the canvas: only `classList.toggle(name, force)` is
// exercised by the controller. The DOM is irrelevant to the mode transitions.
function fakeCanvas(record: Map<string, boolean>): HTMLCanvasElement {
  return {
    classList: {
      toggle(name: string, force: boolean) {
        record.set(name, force);
        return force;
      },
    },
  } as unknown as HTMLCanvasElement;
}

function harness(initial: Partial<Record<FlagName, boolean>> = {}): Harness {
  const flags: Record<FlagName, boolean> = {
    drawing: false,
    panning: true,
    spacePanning: false,
    ...initial,
  };
  const canvasClasses = new Map<string, boolean>();
  const recorder: Recorder = {
    selectedTargetCleared: 0,
    editingAnnotationCleared: 0,
    draftCleared: 0,
    statuses: [],
    popoverUpdates: 0,
  };
  const deps: InteractionControllerDeps = {
    getDrawing: () => flags.drawing,
    setDrawing: (value) => {
      flags.drawing = value;
    },
    getPanning: () => flags.panning,
    setPanning: (value) => {
      flags.panning = value;
    },
    getSpacePanning: () => flags.spacePanning,
    setSpacePanning: (value) => {
      flags.spacePanning = value;
    },
    setSelectedTarget: () => {
      recorder.selectedTargetCleared += 1;
    },
    setEditingAnnotation: () => {
      recorder.editingAnnotationCleared += 1;
    },
    getDragging: () => null,
    canvas: fakeCanvas(canvasClasses),
    selectToolEl: null,
    panToolEl: null,
    drawToolEl: null,
    clearDraftSelection: () => {
      recorder.draftCleared += 1;
    },
    setSelectionStatus: (message) => {
      recorder.statuses.push(message);
    },
    updateSelectionPopover: () => {
      recorder.popoverUpdates += 1;
    },
  };
  return { deps, flags, canvasClasses, recorder };
}

test("createInteractionController exposes the wiring surface app.ts consumes", () => {
  const controller = createInteractionController(harness().deps);
  assert.equal(typeof controller.setDrawMode, "function");
  assert.equal(typeof controller.setSelectMode, "function");
  assert.equal(typeof controller.setPanMode, "function");
  assert.equal(typeof controller.setSpacePanMode, "function");
  assert.equal(typeof controller.updateInteractionModeUi, "function");
});

test("setDrawMode(true) enters draw mode, clears the target, and prompts to drag", () => {
  const h = harness();
  const controller = createInteractionController(h.deps);
  controller.setDrawMode(true);
  assert.equal(h.flags.drawing, true);
  assert.equal(h.flags.panning, false);
  assert.equal(h.recorder.selectedTargetCleared, 1);
  assert.equal(h.recorder.editingAnnotationCleared, 1);
  assert.equal(h.recorder.draftCleared, 0); // only cleared when leaving draw mode
  assert.deepEqual(h.recorder.statuses, ["Drag an area. Esc cancels."]);
  assert.equal(h.canvasClasses.get("is-drawing"), true);
});

test("setDrawMode(false) leaves draw mode, clears the draft, and reports off", () => {
  const h = harness({ drawing: true, panning: false });
  const controller = createInteractionController(h.deps);
  controller.setDrawMode(false);
  assert.equal(h.flags.drawing, false);
  assert.equal(h.recorder.selectedTargetCleared, 0);
  assert.equal(h.recorder.draftCleared, 1);
  assert.deepEqual(h.recorder.statuses, ["Draw mode off."]);
});

test("setSelectMode clears both interaction flags and the draft", () => {
  const h = harness({ panning: true, drawing: true });
  const controller = createInteractionController(h.deps);
  controller.setSelectMode();
  assert.equal(h.flags.panning, false);
  assert.equal(h.flags.drawing, false);
  assert.equal(h.recorder.draftCleared, 1);
  assert.deepEqual(h.recorder.statuses, [""]);
  assert.equal(h.canvasClasses.get("is-panning-mode"), false);
});

test("setPanMode turns panning on, drawing off, and reports pan mode", () => {
  const h = harness({ panning: false, drawing: true });
  const controller = createInteractionController(h.deps);
  controller.setPanMode();
  assert.equal(h.flags.panning, true);
  assert.equal(h.flags.drawing, false);
  assert.equal(h.recorder.draftCleared, 1);
  assert.deepEqual(h.recorder.statuses, ["Pan mode on."]);
  assert.equal(h.canvasClasses.get("is-panning-mode"), true);
});

test("setSpacePanMode is a no-op when the flag already matches", () => {
  const h = harness({ spacePanning: false });
  const controller = createInteractionController(h.deps);
  controller.setSpacePanMode(false);
  // No UI sync happened, so the canvas class map stays empty.
  assert.equal(h.canvasClasses.size, 0);
  controller.setSpacePanMode(true);
  assert.equal(h.flags.spacePanning, true);
  assert.equal(h.canvasClasses.get("is-space-panning"), true);
});
