import test from "node:test";
import assert from "node:assert/strict";
import { createActivityEvent } from "../src/activity.js";

test("creates timestamped agent activity events at map addresses", () => {
  const event = createActivityEvent(
    { deepLink: "codemap://file/s123456?path=src%2Fa.ts", bounds: { x: 0, y: 0, width: 1, height: 1 } },
    { agentId: "codex", activityState: "editing", timestamp: "2026-05-20T00:00:00.000Z" },
  );

  assert.equal(event.agentId, "codex");
  assert.equal(event.activityState, "editing");
  assert.equal(event.timestamp, "2026-05-20T00:00:00.000Z");
  assert.equal(event.address.deepLink, "codemap://file/s123456?path=src%2Fa.ts");
});
