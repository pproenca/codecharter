/**
 * Press-and-hold "clear activity" gesture state machine. Owns the hold timer and
 * the completed-hold latch (both module-private to this factory) and decides,
 * with the pure `clearActivityClickAction` helper, when a click should clear vs.
 * be swallowed after a completed hold. The actual clear (API + state mutation)
 * stays in app.ts behind the injected `clearActivityHistory` callback, and the
 * hover readout is reached through `setHoverText`, so this controller holds no
 * map state and no DOM coupling beyond the single button element it is handed.
 */

import { clearActivityClickAction } from "../activity-clear.ts";

type TimerHandle = number | ReturnType<typeof setTimeout> | null;

type ClearActivityControl =
  | (HTMLElement & {
      disabled?: boolean;
      setPointerCapture?: (pointerId: number) => void;
    })
  | null;

const CLEAR_ACTIVITY_HOLD_MS = 1600;

export type ActivityGestureControllerDeps = {
  /** The #clearActivityTool button element. */
  clearActivityTool: ClearActivityControl;
  /** Write a message to the hover readout (wraps setText(controls.hover, …)). */
  setHoverText: (text: string) => void;
  /** Perform the API call + state mutation after a completed hold or click. */
  clearActivityHistory: () => Promise<void>;
};

export type ActivityGestureController = ReturnType<typeof createActivityGestureController>;

export function createActivityGestureController(deps: ActivityGestureControllerDeps) {
  let clearActivityHold: TimerHandle = null;
  let clearActivityCompletedHold = false;

  function bindClearActivityHold() {
    const control = deps.clearActivityTool;
    if (!control) {
      return;
    }
    control.addEventListener("pointerdown", onClearActivityPointerDown);
    control.addEventListener("pointerup", cancelClearActivityHold);
    control.addEventListener("pointerleave", cancelClearActivityHold);
    control.addEventListener("pointercancel", cancelClearActivityHold);
    control.addEventListener("lostpointercapture", cancelClearActivityHold);
    control.addEventListener("keydown", onClearActivityKeyDown);
    control.addEventListener("keyup", onClearActivityKeyUp);
    control.addEventListener("click", onClearActivityClick);
  }

  function onClearActivityPointerDown(event: PointerEvent) {
    if (event.button !== 0 || deps.clearActivityTool?.disabled) {
      return;
    }
    event.preventDefault();
    deps.clearActivityTool?.setPointerCapture?.(event.pointerId);
    startClearActivityHold();
  }

  function onClearActivityKeyDown(event: KeyboardEvent) {
    if (event.repeat || deps.clearActivityTool?.disabled) {
      return;
    }
    if (event.key !== " " && event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    startClearActivityHold();
  }

  function onClearActivityKeyUp(event: KeyboardEvent) {
    if (event.key !== " " && event.key !== "Enter") {
      return;
    }
    cancelClearActivityHold();
  }

  function startClearActivityHold() {
    cancelClearActivityHold();
    deps.clearActivityTool?.classList.add("is-holding");
    deps.clearActivityTool?.setAttribute(
      "aria-description",
      "Hold until the progress fill completes to clear activity history.",
    );
    deps.setHoverText("Hold to clear activity");
    clearActivityHold = setTimeout(() => {
      clearActivityHold = null;
      clearActivityCompletedHold = true;
      deps.clearActivityTool?.classList.remove("is-holding");
      deps.clearActivityTool?.removeAttribute("aria-description");
      void deps.clearActivityHistory();
    }, CLEAR_ACTIVITY_HOLD_MS);
  }

  function onClearActivityClick(event: MouseEvent) {
    event.preventDefault();
    const action = clearActivityClickAction({
      clearedByCompletedHold: clearActivityCompletedHold,
      disabled: deps.clearActivityTool?.disabled === true,
    });
    clearActivityCompletedHold = false;
    if (action !== "clear") {
      return;
    }
    cancelClearActivityHold();
    void deps.clearActivityHistory();
  }

  function cancelClearActivityHold() {
    if (!clearActivityHold) {
      return;
    }
    clearTimeout(clearActivityHold);
    clearActivityHold = null;
    deps.clearActivityTool?.classList.remove("is-holding");
    deps.clearActivityTool?.removeAttribute("aria-description");
    deps.setHoverText("Clear cancelled");
  }

  return { bindClearActivityHold, cancelClearActivityHold };
}
