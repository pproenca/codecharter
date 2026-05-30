/**
 * Activity write lifecycle. Owns the form-submit path (addActivity reads the
 * #activityForm FormData and POSTs a new activity event, then schedules a
 * refresh) and the destructive clearActivityHistory path (DELETE + reset of the
 * activity/signature/version/detail state, fog rebuild, and conditional
 * selected-target null-out). The semantic state fields stay in app state and
 * are reached through injected setters/getters so this controller holds no
 * second identity model; the API verbs (postJson/deleteJson) and the post-submit
 * refresh are app-owned callbacks, and the hover readout is reached through
 * setHoverText, keeping the controller DOM-light.
 */

import type { ActivityEvent } from "../render/types.ts";
import { activitySignature } from "./polling.ts";

type ActivityDetail = "summary" | "full";

export type ActivitySubmitControllerDeps = {
  /** #activityForm element — addActivity reads FormData from it and POSTs it. */
  activityForm: HTMLFormElement | null;
  /** #clearActivityTool button — clearActivityHistory disables/re-enables it. */
  clearActivityTool: (HTMLElement & { disabled?: boolean }) | null;
  // --- activity state setters (state stays in app.ts) ---
  setActivity: (events: ActivityEvent[]) => void;
  setActivitySignature: (sig: string) => void;
  setActivityVersion: (version: string) => void;
  setActivityDetail: (detail: ActivityDetail) => void;
  /** Read current selectedTarget to decide whether to null it after clear. */
  getSelectedTarget: () => { targetType: string } | null;
  /** Null out selectedTarget when it is an activity target after clear. */
  setSelectedTarget: (target: null) => void;
  /** Rebuild the fog overlay after activity state changes. */
  rebuildActivityFog: () => void;
  /** setText(controls.hover, text). */
  setHoverText: (text: string) => void;
  render: () => void;
  /** Thin wrapper around fetch POST (same signature as app.ts postJson). */
  postJson: (url: string, body: unknown) => Promise<unknown>;
  /** Thin wrapper around fetch DELETE (same signature as app.ts deleteJson). */
  deleteJson: (url: string) => Promise<unknown>;
  /** polling.refreshActivity — scheduled 250 ms after a successful submit. */
  refreshActivity: () => Promise<void>;
};

export type ActivitySubmitController = ReturnType<typeof createActivitySubmitController>;

export function createActivitySubmitController(deps: ActivitySubmitControllerDeps) {
  async function addActivity(event: SubmitEvent) {
    event.preventDefault();
    if (!(deps.activityForm instanceof HTMLFormElement)) {
      return;
    }
    const data = formDataObject(new FormData(deps.activityForm));
    await deps.postJson("/api/activity", {
      agentId: data.agentId,
      activityState: data.activityState,
      path: data.path,
      lineStart: Number(data.lineStart),
      lineEnd: Number(data.lineEnd),
    });
    setTimeout(deps.refreshActivity, 250);
  }

  function formDataObject(formData: FormData): Record<string, FormDataEntryValue> {
    return Object.fromEntries(formData);
  }

  async function clearActivityHistory() {
    if (deps.clearActivityTool) {
      deps.clearActivityTool.disabled = true;
    }
    try {
      await deps.deleteJson("/api/activity");
      deps.setActivity([]);
      deps.setActivitySignature(activitySignature([]));
      deps.setActivityVersion("");
      deps.setActivityDetail("summary");
      deps.rebuildActivityFog();
      if (deps.getSelectedTarget()?.targetType === "activity") {
        deps.setSelectedTarget(null);
      }
      deps.setHoverText("Activity cleared");
      deps.render();
    } finally {
      if (deps.clearActivityTool) {
        deps.clearActivityTool.disabled = false;
        deps.clearActivityTool.classList.remove("is-holding");
      }
    }
  }

  return { addActivity, clearActivityHistory };
}
