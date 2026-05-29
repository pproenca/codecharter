/**
 * Interaction-mode controller: draw / select / pan / space-pan mode transitions
 * and toolbar UI sync. The interaction flags (drawing, panning, spacePanning) stay
 * in app `state`; this controller operates through injected getters/setters and
 * app-owned callbacks (clearDraftSelection, setSelectionStatus,
 * updateSelectionPopover). The toolbar button elements and canvas are passed
 * directly because they are stable DOM singletons acquired at boot. The pure
 * `interactionModeUiState` mapping lives in `render/camera.ts` (unit-tested there)
 * and is imported directly, mirroring how `camera.ts` imports the projection math.
 */

import { interactionModeUiState } from "../render/camera.ts";

type ToolButton = HTMLElement | null;

export type InteractionControllerDeps = {
  // --- state getters/setters ---
  getDrawing: () => boolean;
  setDrawing: (value: boolean) => void;
  getPanning: () => boolean;
  setPanning: (value: boolean) => void;
  getSpacePanning: () => boolean;
  setSpacePanning: (value: boolean) => void;
  /** Null out selectedTarget when entering draw mode. */
  setSelectedTarget: (target: null) => void;
  /** Null out editingAnnotation when entering draw mode. */
  setEditingAnnotation: (annotation: null) => void;
  /** Drag discriminant snapshot — `interactionModeUiState` reads the pan latch. */
  getDragging: () => { type: "draw" | "pan" | "select" } | null;
  // --- DOM ---
  canvas: HTMLCanvasElement;
  selectToolEl: ToolButton;
  panToolEl: ToolButton;
  drawToolEl: ToolButton;
  // --- app-owned callbacks ---
  clearDraftSelection: () => void;
  setSelectionStatus: (message: string) => void;
  updateSelectionPopover: () => void;
};

export type InteractionController = ReturnType<typeof createInteractionController>;

export function createInteractionController(deps: InteractionControllerDeps) {
  function updateInteractionModeUi() {
    const mode = interactionModeUiState({
      drawing: deps.getDrawing(),
      panning: deps.getPanning(),
      spacePanning: deps.getSpacePanning(),
      dragging: deps.getDragging(),
    });
    deps.selectToolEl?.classList.toggle("active", mode.selectActive);
    deps.selectToolEl?.setAttribute("aria-pressed", String(mode.selectActive));
    deps.panToolEl?.classList.toggle("active", mode.panActive);
    deps.panToolEl?.setAttribute("aria-pressed", String(mode.panActive));
    deps.drawToolEl?.classList.toggle("active", mode.drawActive);
    deps.drawToolEl?.setAttribute("aria-pressed", String(mode.drawActive));
    deps.canvas.classList.toggle("is-panning-mode", mode.panningMode);
    deps.canvas.classList.toggle("is-drawing", mode.drawingMode);
    deps.canvas.classList.toggle("is-space-panning", mode.spacePanningMode);
    deps.canvas.classList.toggle("is-panning", mode.panning);
  }

  function setDrawMode(enabled: boolean) {
    deps.setDrawing(enabled);
    deps.setPanning(false);
    if (enabled) {
      deps.setSelectedTarget(null);
      deps.setEditingAnnotation(null);
    }
    if (!enabled) {
      deps.clearDraftSelection();
    }
    updateInteractionModeUi();
    deps.setSelectionStatus(enabled ? "Drag an area. Esc cancels." : "Draw mode off.");
    deps.updateSelectionPopover();
  }

  function setSelectMode() {
    deps.setPanning(false);
    deps.setDrawing(false);
    deps.clearDraftSelection();
    updateInteractionModeUi();
    deps.setSelectionStatus("");
    deps.updateSelectionPopover();
  }

  function setPanMode() {
    deps.setPanning(true);
    deps.setDrawing(false);
    deps.clearDraftSelection();
    updateInteractionModeUi();
    deps.setSelectionStatus("Pan mode on.");
    deps.updateSelectionPopover();
  }

  function setSpacePanMode(enabled: boolean) {
    if (deps.getSpacePanning() === enabled) {
      return;
    }
    deps.setSpacePanning(enabled);
    updateInteractionModeUi();
  }

  return { setDrawMode, setSelectMode, setPanMode, setSpacePanMode, updateInteractionModeUi };
}
