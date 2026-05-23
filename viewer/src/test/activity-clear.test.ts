import test from "node:test";
import assert from "node:assert/strict";

import { clearActivityClickAction } from "../main/activity-clear.ts";

test("enabled clear activity click starts a clear action", () => {
  assert.equal(clearActivityClickAction({ disabled: false, clearedByCompletedHold: false }), "clear");
});

test("clear activity click after a completed hold is ignored once", () => {
  assert.equal(clearActivityClickAction({ disabled: false, clearedByCompletedHold: true }), "ignore");
});
