/**
 * Annotation editing + selection-save controller: the fused surface that creates,
 * edits, deletes, and copies annotations, saves resolved selections, and keeps the
 * pending-delete confirmation. The semantic state (selected target, editing
 * annotation, draft/resolved selection) stays in app state — the render loop and
 * `updateSelectionPopover` read it — so this controller operates through injected
 * getters/setters and app-owned UI callbacks. Only the pending-delete latch and
 * the copy-prompt label timer are module-private to this factory. Pure clipboard,
 * copy-outcome, request, and prompt-text helpers are imported directly.
 */

import { annotationPromptCopyOutcome } from "../annotation-copy.ts";
import { deleteAnnotationRequest } from "../annotations.ts";
import { copyTextToClipboard } from "../clipboard.ts";
import { annotationClipboardText } from "../render/source-panel.ts";
import type { Bounds, MapAnnotationPlace, NamedPlace } from "../render/types.ts";

type AnnotationHit = NamedPlace & { targetType: "annotation" };

type ResolvedSelection = {
  level?: string;
  geometry: { bounds: Bounds };
  resolvedTargets?: unknown[];
  spatialFrame?: { level?: string; corners?: { northWest?: string } };
  coveringSet?: string[];
};

type AnnotationSaveResponse = { annotation: MapAnnotationPlace & { id: string } };

type PendingAnnotationDelete = { id: string; timer: number | ReturnType<typeof setTimeout> };

type EditingControl =
  | (HTMLElement & {
      checked?: boolean;
      disabled?: boolean;
      value?: string;
    })
  | null;

type EditingControls = {
  saveSelection: EditingControl;
  copyAnnotationPrompt: EditingControl;
  deleteAnnotation: EditingControl;
  deleteAnnotationAction: EditingControl;
  selectionComment: EditingControl;
  annotationFeedback: EditingControl;
};

type EditingNamedPlacesState = {
  namedPlaces: NamedPlace[];
  namedPlacesById: Map<string, NamedPlace>;
  namedPlaceIndexesById: Map<string, number>;
  drawing: boolean;
  panning: boolean;
};

export type EditingControllerDeps = {
  controls: EditingControls;
  defaultMapLevel: string;
  saveAndCopyLabel: string;
  copyPromptLabel: string;
  deleteAnnotationLabel: string;
  confirmDeleteAnnotationLabel: string;
  deleteAnnotationConfirmMs: number;
  /** Named-places collections + draw/pan flags mutated in place during save/delete. */
  state: EditingNamedPlacesState;
  getEditingAnnotation: () => AnnotationHit | null;
  setEditingAnnotation: (annotation: AnnotationHit | null) => void;
  getSelectedTarget: () => unknown;
  setSelectedTarget: (target: unknown) => void;
  getDraftSelection: () => { type: "rect"; bounds: Bounds } | null;
  setDraftSelection: (draft: { type: "rect"; bounds: Bounds } | null) => void;
  getResolvedSelection: () => ResolvedSelection | null;
  setResolvedSelection: (resolved: ResolvedSelection | null) => void;
  setSaveButtonLabel: (label?: string) => void;
  setCopyButtonLabel: (label?: string, options?: { reset?: boolean }) => void;
  setSelectionStatus: (message: string) => void;
  updateSelectionPopover: () => void;
  positionAnnotationActions: (
    annotation: MapAnnotationPlace | null,
    options?: { visible?: boolean },
  ) => void;
  focusSelectionComment: () => void;
  updateInteractionModeUi: () => void;
  render: () => void;
  postJson: <T = unknown>(url: string, body: unknown) => Promise<T>;
  syncHashRoute: (hash: string) => void;
  createAnnotationHashRoute: (id: string) => string;
};

export type EditingController = ReturnType<typeof createEditingController>;

export function createEditingController(deps: EditingControllerDeps) {
  let pendingAnnotationDelete: PendingAnnotationDelete | null = null;

  function selectedAnnotation(): AnnotationHit | null {
    const target = deps.getSelectedTarget() as AnnotationHit | null;
    return target?.targetType === "annotation" ? target : null;
  }

  function annotationTitle(annotation: MapAnnotationPlace | null) {
    const title =
      annotation?.comment?.trim().split(/\r?\n/).find(Boolean) ?? annotation?.name?.trim() ?? "";
    return title || "Map annotation";
  }

  function upsertNamedPlace(place: NamedPlace) {
    if (!place.id) {
      return;
    }
    const index = deps.state.namedPlaceIndexesById.get(place.id);
    if (index === undefined) {
      deps.state.namedPlaces.push(place);
      deps.state.namedPlaceIndexesById.set(place.id, deps.state.namedPlaces.length - 1);
    } else {
      deps.state.namedPlaces[index] = place;
    }
    deps.state.namedPlacesById.set(place.id, place);
  }

  function removeNamedPlace(id: string) {
    const index = deps.state.namedPlaceIndexesById.get(id);
    if (index === undefined) {
      return;
    }
    deps.state.namedPlaces.splice(index, 1);
    deps.state.namedPlacesById.delete(id);
    deps.state.namedPlaceIndexesById.delete(id);
    for (let nextIndex = index; nextIndex < deps.state.namedPlaces.length; nextIndex += 1) {
      const place = deps.state.namedPlaces[nextIndex];
      if (place?.id) {
        deps.state.namedPlaceIndexesById.set(place.id, nextIndex);
      }
    }
  }

  function selectAnnotation(annotation: MapAnnotationPlace) {
    clearPendingAnnotationDelete();
    deps.setSelectedTarget({ ...annotation, targetType: "annotation" });
    deps.setDraftSelection(null);
    deps.setResolvedSelection(null);
    deps.setEditingAnnotation(null);
    deps.syncHashRoute(deps.createAnnotationHashRoute(annotation.id ?? ""));
    if (deps.controls.selectionComment) {
      deps.controls.selectionComment.value = "";
    }
    if (deps.controls.saveSelection) {
      deps.controls.saveSelection.disabled = true;
    }
    deps.setSaveButtonLabel();
    deps.setCopyButtonLabel();
    setAnnotationFeedback("");
    deps.updateSelectionPopover();
    deps.render();
  }

  function editSelectedAnnotation() {
    const annotation = selectedAnnotation();
    if (!annotation) {
      return;
    }
    clearPendingAnnotationDelete();
    deps.setEditingAnnotation(annotation);
    deps.setDraftSelection(null);
    deps.setResolvedSelection(null);
    if (deps.controls.selectionComment) {
      deps.controls.selectionComment.value = annotation.comment ?? "";
    }
    deps.updateSelectionPopover();
    deps.focusSelectionComment();
    deps.setSelectionStatus("Adjust the prompt text, then copy or press Escape.");
    deps.render();
  }

  async function saveSelection() {
    clearPendingAnnotationDelete();
    const annotation = selectedAnnotation();
    if (
      annotation &&
      deps.getResolvedSelection() === null &&
      deps.getEditingAnnotation() === null
    ) {
      await copySelectedAnnotationPrompt();
      return;
    }
    const editingAnnotation = deps.getEditingAnnotation();
    if (editingAnnotation) {
      await copyEditedAnnotationPrompt(editingAnnotation);
      return;
    }
    const selection = deps.getResolvedSelection();
    if (!selection) {
      return;
    }
    const comment = deps.controls.selectionComment?.value?.trim() ?? "";
    if (deps.controls.saveSelection) {
      deps.controls.saveSelection.disabled = true;
    }
    deps.setSaveButtonLabel("Saving...");
    deps.setSelectionStatus("Saving annotation...");
    const payload = {
      comment,
      level: selection.level ?? deps.defaultMapLevel,
      geometry: selection.geometry,
    };
    const savedPromise = deps.postJson<AnnotationSaveResponse>("/api/annotations", payload);
    const copiedPromise = copyDeferredToClipboard(
      savedPromise.then((saved) =>
        annotationClipboardText(saved.annotation, {
          origin: window.location.origin,
          href: window.location.href,
        }),
      ),
    );
    const saved = await savedPromise;
    upsertNamedPlace(saved.annotation);
    const copied = await copiedPromise;
    const copyOutcome = annotationPromptCopyOutcome(copied);
    deps.setSelectedTarget(
      copyOutcome.closeActions ? null : { ...saved.annotation, targetType: "annotation" },
    );
    deps.syncHashRoute(deps.createAnnotationHashRoute(saved.annotation.id));
    deps.state.drawing = false;
    deps.state.panning = true;
    deps.setDraftSelection(null);
    deps.setResolvedSelection(null);
    deps.setEditingAnnotation(null);
    deps.updateInteractionModeUi();
    deps.updateSelectionPopover();
    deps.setCopyButtonLabel();
    deps.setSaveButtonLabel(copied ? "Copied" : "Saved. Copy failed");
    if (!copyOutcome.copied) {
      setAnnotationFeedback("Saved, but clipboard copy failed.", "error");
    }
    deps.setSelectionStatus(copied ? "Copied." : "Saved. Copy failed.");
    deps.render();
  }

  async function copyEditedAnnotationPrompt(annotation: MapAnnotationPlace) {
    const comment = deps.controls.selectionComment?.value?.trim() ?? "";
    const copied = await copyToClipboard(
      annotationClipboardText(
        { ...annotation, comment },
        {
          origin: window.location.origin,
          href: window.location.href,
        },
      ),
    );
    const copyOutcome = annotationPromptCopyOutcome(copied);
    deps.setEditingAnnotation(null);
    if (copyOutcome.closeActions) {
      deps.setSelectedTarget(null);
    }
    if (deps.controls.selectionComment) {
      deps.controls.selectionComment.value = "";
    }
    deps.updateSelectionPopover();
    deps.setCopyButtonLabel(copyOutcome.buttonLabel, { reset: true });
    if ("feedback" in copyOutcome) {
      setAnnotationFeedback(copyOutcome.feedback.message, copyOutcome.feedback.tone);
    }
    deps.setSelectionStatus(copyOutcome.selectionStatus);
    deps.render();
    return copied;
  }

  function clearAnnotationForm() {
    clearPendingAnnotationDelete();
    if (deps.getDraftSelection() || deps.getResolvedSelection()) {
      return;
    }
    deps.setEditingAnnotation(null);
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
    deps.updateSelectionPopover();
  }

  async function deleteSelectedAnnotation() {
    const annotation = selectedAnnotation();
    if (!annotation?.id) {
      return;
    }
    if (!isPendingAnnotationDelete(annotation)) {
      armAnnotationDelete(annotation);
      return;
    }
    clearPendingAnnotationDelete();
    setDeleteButtonsDisabled(true);
    deps.setSelectionStatus("Deleting annotation…");
    await deleteAnnotationRequest(annotation.id);
    removeNamedPlace(annotation.id);
    deps.setSelectedTarget(null);
    deps.setDraftSelection(null);
    deps.setResolvedSelection(null);
    deps.setEditingAnnotation(null);
    if (deps.controls.selectionComment) {
      deps.controls.selectionComment.value = "";
    }
    if (window.location.hash === deps.createAnnotationHashRoute(annotation.id)) {
      window.history.replaceState(null, "", "#");
    }
    setDeleteButtonsDisabled(false);
    if (deps.controls.deleteAnnotation) {
      deps.controls.deleteAnnotation.hidden = true;
    }
    deps.setSaveButtonLabel();
    deps.setCopyButtonLabel();
    setDeleteButtonLabel();
    deps.setSelectionStatus("Annotation deleted.");
    deps.updateSelectionPopover();
    deps.render();
  }

  function armAnnotationDelete(annotation: MapAnnotationPlace) {
    if (!annotation.id) {
      return;
    }
    clearPendingAnnotationDelete();
    setDeleteButtonLabel(deps.confirmDeleteAnnotationLabel);
    deps.setSelectionStatus("Press Delete again to delete this annotation.");
    pendingAnnotationDelete = {
      id: annotation.id,
      timer: window.setTimeout(() => {
        pendingAnnotationDelete = null;
        setDeleteButtonLabel();
        deps.setSelectionStatus("Delete confirmation expired.");
      }, deps.deleteAnnotationConfirmMs),
    };
  }

  function isPendingAnnotationDelete(annotation: MapAnnotationPlace) {
    return pendingAnnotationDelete?.id === annotation.id;
  }

  function clearPendingAnnotationDelete() {
    if (!pendingAnnotationDelete) {
      return;
    }
    window.clearTimeout(pendingAnnotationDelete.timer);
    pendingAnnotationDelete = null;
    setDeleteButtonLabel();
  }

  function setDeleteButtonLabel(label = deps.deleteAnnotationLabel) {
    if (deps.controls.deleteAnnotation) {
      deps.controls.deleteAnnotation.textContent = label;
    }
    if (deps.controls.deleteAnnotationAction) {
      deps.controls.deleteAnnotationAction.textContent = label;
    }
  }

  function setDeleteButtonsDisabled(disabled: boolean) {
    if (deps.controls.deleteAnnotation) {
      deps.controls.deleteAnnotation.disabled = disabled;
    }
    if (deps.controls.deleteAnnotationAction) {
      deps.controls.deleteAnnotationAction.disabled = disabled;
    }
  }

  async function copySelectedAnnotationPrompt() {
    const annotation = selectedAnnotation();
    if (!annotation) {
      return false;
    }
    const copied = await copyToClipboard(
      annotationClipboardText(annotation, {
        origin: window.location.origin,
        href: window.location.href,
      }),
    );
    const copyOutcome = annotationPromptCopyOutcome(copied);
    if (copyOutcome.closeActions) {
      deps.setSelectedTarget(null);
    }
    deps.setCopyButtonLabel(copyOutcome.buttonLabel, { reset: true });
    if ("feedback" in copyOutcome) {
      setAnnotationFeedback(copyOutcome.feedback.message, copyOutcome.feedback.tone);
    }
    deps.setSelectionStatus(copyOutcome.selectionStatus);
    deps.updateSelectionPopover();
    deps.render();
    return copied;
  }

  function setAnnotationFeedback(message: string, tone = "neutral") {
    if (!deps.controls.annotationFeedback) {
      return;
    }
    deps.controls.annotationFeedback.textContent = message;
    deps.controls.annotationFeedback.hidden = !message;
    deps.controls.annotationFeedback.dataset.tone = tone;
    const annotation = selectedAnnotation();
    const annotationActionsVisible =
      annotation !== null &&
      deps.getDraftSelection() === null &&
      deps.getResolvedSelection() === null &&
      deps.getEditingAnnotation() === null;
    deps.positionAnnotationActions(annotation, { visible: annotationActionsVisible });
  }

  async function copyToClipboard(text: string) {
    return copyTextToClipboard(text);
  }

  async function copyDeferredToClipboard(textPromise: Promise<string>) {
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

  return {
    selectedAnnotation,
    annotationTitle,
    upsertNamedPlace,
    removeNamedPlace,
    selectAnnotation,
    editSelectedAnnotation,
    saveSelection,
    copyEditedAnnotationPrompt,
    clearAnnotationForm,
    deleteSelectedAnnotation,
    armAnnotationDelete,
    isPendingAnnotationDelete,
    clearPendingDelete: clearPendingAnnotationDelete,
    setDeleteButtonLabel,
    setDeleteButtonsDisabled,
    copySelectedAnnotationPrompt,
    setAnnotationFeedback,
    copyDeferredToClipboard,
  };
}
