/**
 * Selection overlay/popover UI controller: drives the selection popover
 * visibility, the annotation-actions panel positioning, overlay reset, draft
 * clearance, and named-places sync. The semantic state (draft/resolved
 * selection, editing annotation, named-places collections) stays in app state —
 * the render loop and the editing controller read it — so this controller
 * operates through injected getters/setters and app-owned UI callbacks exactly
 * like camera.ts and editing.ts. It creates no second identity model.
 *
 * positionAnnotationActions is called both from updateSelectionPopover (popover
 * sync) and from the render loop directly, so it is exported as a named method
 * app.ts can invoke from both sites. Pure clamp/text helpers are module-private.
 */

import type { Bounds, MapAnnotationPlace, NamedPlace } from "../render/types.ts";

type ResolvedSelection = {
  level?: string;
  geometry: { bounds: Bounds };
  resolvedTargets?: unknown[];
  spatialFrame?: { level?: string; corners?: { northWest?: string } };
  coveringSet?: string[];
};

type OverlayControl =
  | (HTMLElement & {
      disabled?: boolean;
      value?: string;
    })
  | null;

type OverlayControls = {
  selectionPopover: OverlayControl;
  annotationActions: OverlayControl;
  deleteAnnotation: OverlayControl;
  selectionContext: OverlayControl;
  annotationTitle: OverlayControl;
  annotationMeta: OverlayControl;
  saveSelection: OverlayControl;
  selectionComment: OverlayControl;
};

type OverlayState = {
  dragging: unknown | null;
  drawing: boolean;
  panning: boolean;
  draftSelection: { type: "rect"; bounds: Bounds } | null;
  resolvedSelection: ResolvedSelection | null;
  editingAnnotation: MapAnnotationPlace | null;
  namedPlaces: NamedPlace[];
  namedPlacesById: Map<string, NamedPlace>;
  namedPlaceIndexesById: Map<string, number>;
};

export type SelectionOverlayControllerDeps = {
  /** The mutable shared state object; fields are read and written in place. */
  state: OverlayState;
  controls: OverlayControls;
  defaultMapLevel: string;
  saveAndCopyLabel: string;
  copyPromptLabel: string;
  /** Resolved annotation title for the popover heading. */
  getAnnotationTitle: (annotation: MapAnnotationPlace | null) => string;
  /** Currently selected annotation, or null. */
  getSelectedAnnotation: () => MapAnnotationPlace | null;
  /** Cancel the pending-delete latch owned by the editing controller. */
  clearEditingPendingDelete: () => void;
  /** Update toolbar/canvas classes for interaction mode after a state change. */
  updateInteractionModeUi: () => void;
  setSaveButtonLabel: (label?: string) => void;
  setSelectionStatus: (message: string) => void;
  /** Convert map-space bounds to the current screen-space rect. */
  screenBounds: (bounds: Bounds) => Bounds;
  /** Live canvas client size for positioning math. */
  canvasSize: () => { clientWidth: number; clientHeight: number };
};

export type SelectionOverlayController = ReturnType<typeof createSelectionOverlayController>;

export function createSelectionOverlayController(deps: SelectionOverlayControllerDeps) {
  function setText(element: HTMLElement | null, value: string) {
    if (element) {
      element.textContent = value;
    }
  }

  function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
  }

  function selectionContextLabel(selection: ResolvedSelection | MapAnnotationPlace | null) {
    if (!selection) {
      return "";
    }
    const targets = selection.resolvedTargets ?? [];
    const targetCount = targets.length;
    const targetLabel = targetCount === 1 ? "1 file" : `${targetCount} files`;
    const level = selection.level ?? selection.spatialFrame?.level ?? deps.defaultMapLevel;
    const prefix = selection.coveringSet?.[0] ?? selection.spatialFrame?.corners?.northWest ?? "";
    return [targetLabel, `${level} level`, prefix].filter(Boolean).join(" · ");
  }

  function clearDraftSelection() {
    deps.clearEditingPendingDelete();
    deps.state.dragging = null;
    deps.state.draftSelection = null;
    deps.state.resolvedSelection = null;
    deps.state.editingAnnotation = null;
    if (deps.controls.saveSelection) {
      deps.controls.saveSelection.disabled = true;
    }
    deps.setSaveButtonLabel();
    updateSelectionPopover();
  }

  function resetSelectionOverlay() {
    deps.clearEditingPendingDelete();
    deps.state.dragging = null;
    deps.state.drawing = false;
    deps.state.panning = true;
    deps.state.draftSelection = null;
    deps.state.resolvedSelection = null;
    deps.state.editingAnnotation = null;
    if (deps.controls.selectionComment) {
      deps.controls.selectionComment.value = "";
    }
    if (deps.controls.saveSelection) {
      deps.controls.saveSelection.disabled = true;
    }
    if (deps.controls.deleteAnnotation) {
      deps.controls.deleteAnnotation.hidden = true;
    }
    deps.setSaveButtonLabel();
    deps.setSelectionStatus("");
    deps.updateInteractionModeUi();
    updateSelectionPopover();
  }

  function setNamedPlaces(places: NamedPlace[]) {
    deps.state.namedPlaces = places;
    deps.state.namedPlacesById = new Map();
    deps.state.namedPlaceIndexesById = new Map();
    for (let index = 0; index < places.length; index += 1) {
      const place = places[index];
      if (!place?.id) {
        continue;
      }
      deps.state.namedPlacesById.set(place.id, place);
      deps.state.namedPlaceIndexesById.set(place.id, index);
    }
  }

  function updateSelectionPopover() {
    const annotation = deps.getSelectedAnnotation();
    const isEditing = deps.state.editingAnnotation !== null;
    const hasDraft = deps.state.draftSelection !== null || deps.state.resolvedSelection !== null;
    const selectionReady = deps.state.resolvedSelection !== null;
    if (deps.controls.selectionPopover) {
      deps.controls.selectionPopover.hidden = !(hasDraft || isEditing);
    }
    if (deps.controls.annotationActions) {
      deps.controls.annotationActions.hidden = annotation === null || hasDraft || isEditing;
    }
    if (deps.controls.deleteAnnotation) {
      deps.controls.deleteAnnotation.hidden = !isEditing;
    }
    setText(
      deps.controls.selectionContext,
      selectionContextLabel(deps.state.resolvedSelection ?? deps.state.editingAnnotation),
    );
    setText(deps.controls.annotationTitle, deps.getAnnotationTitle(annotation));
    setText(deps.controls.annotationMeta, selectionContextLabel(annotation));
    positionAnnotationActions(annotation, {
      visible: annotation !== null && !hasDraft && !isEditing,
    });
    if (deps.controls.saveSelection) {
      deps.controls.saveSelection.disabled = !(selectionReady || isEditing);
      deps.setSaveButtonLabel(
        isEditing
          ? deps.copyPromptLabel
          : selectionReady
            ? deps.saveAndCopyLabel
            : "Resolving selection...",
      );
    }
  }

  function positionAnnotationActions(
    annotation: MapAnnotationPlace | null,
    { visible = true } = {},
  ) {
    const panel = deps.controls.annotationActions;
    if (!panel || !visible || !annotation?.geometry?.bounds) {
      panel?.style.removeProperty("left");
      panel?.style.removeProperty("top");
      panel?.style.removeProperty("bottom");
      panel?.style.removeProperty("--annotation-pointer-x");
      panel?.removeAttribute("data-placement");
      return;
    }

    const { clientWidth, clientHeight } = deps.canvasSize();
    const margin = 16;
    const gap = 12;
    const statusReserve = 56;
    const target = deps.screenBounds(annotation.geometry.bounds);
    const panelWidth = Math.min(360, Math.max(260, clientWidth - margin * 2));
    panel.style.width = `${panelWidth}px`;
    panel.style.bottom = "auto";

    const panelHeight = panel.offsetHeight || 98;
    const centerX = target.x + target.width / 2;
    const left = clamp(
      centerX - panelWidth / 2,
      margin,
      Math.max(margin, clientWidth - panelWidth - margin),
    );
    const belowTop = target.y + target.height + gap;
    const aboveTop = target.y - panelHeight - gap;
    const fitsBelow = belowTop + panelHeight <= clientHeight - statusReserve;
    const top = fitsBelow ? belowTop : Math.max(margin, aboveTop);

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.setProperty("--annotation-pointer-x", `${centerX - left}px`);
    panel.setAttribute("data-placement", fitsBelow ? "below" : "above");
  }

  return {
    updateSelectionPopover,
    positionAnnotationActions,
    resetSelectionOverlay,
    clearDraftSelection,
    setNamedPlaces,
  };
}
