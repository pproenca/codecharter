import assert from "node:assert/strict";
import test from "node:test";
import {
  type ActivityGestureControllerDeps,
  createActivityGestureController,
} from "../main/controllers/activity-gesture.ts";

function stubDeps(
  overrides: Partial<ActivityGestureControllerDeps> = {},
): ActivityGestureControllerDeps {
  return {
    clearActivityTool: null,
    setHoverText: () => {},
    clearActivityHistory: async () => {},
    ...overrides,
  };
}

test("createActivityGestureController exposes the wiring surface app.ts consumes", () => {
  const controller = createActivityGestureController(stubDeps());
  assert.equal(typeof controller.bindClearActivityHold, "function");
  assert.equal(typeof controller.cancelClearActivityHold, "function");
});

test("bindClearActivityHold is a no-op when the control is absent", () => {
  const controller = createActivityGestureController(stubDeps({ clearActivityTool: null }));
  // Must not throw without a button element.
  assert.doesNotThrow(() => controller.bindClearActivityHold());
});

test("cancelClearActivityHold is idle (no hover write) when no hold is pending", () => {
  let hoverWrites = 0;
  const controller = createActivityGestureController(
    stubDeps({ setHoverText: () => (hoverWrites += 1) }),
  );
  controller.cancelClearActivityHold();
  // The early-return guard means a non-running hold writes nothing.
  assert.equal(hoverWrites, 0);
});
