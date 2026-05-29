import assert from "node:assert/strict";
import test from "node:test";
import {
  activitySignature,
  createPollingController,
  type PollingControllerDeps,
} from "../main/controllers/polling.ts";
import type { ActivityEvent } from "../main/render/types.ts";

test("activitySignature encodes count, last id, last timestamp", () => {
  const events: ActivityEvent[] = [
    { id: "a", timestamp: "2026-05-29T11:00:00.000Z" },
    { id: "b", timestamp: "2026-05-29T12:00:00.000Z" },
  ];
  assert.equal(activitySignature(events), "2:b:2026-05-29T12:00:00.000Z");
});

test("activitySignature falls back to empty fields when last event lacks id/timestamp", () => {
  assert.equal(activitySignature([{}]), "1::");
});

test("activitySignature of an empty feed is the zero-length signature", () => {
  assert.equal(activitySignature([]), "0::");
});

test("activitySignature is sensitive only to count and the last event", () => {
  const a: ActivityEvent[] = [
    { id: "x", timestamp: "t1" },
    { id: "y", timestamp: "t2" },
  ];
  const b: ActivityEvent[] = [
    { id: "z", timestamp: "t9" },
    { id: "y", timestamp: "t2" },
  ];
  assert.equal(activitySignature(a), activitySignature(b));
});

function stubDeps(overrides: Partial<PollingControllerDeps> = {}): PollingControllerDeps {
  return {
    getActivityDetail: () => "summary",
    setActivityDetail: () => {},
    getActivityVersion: () => "",
    setActivityVersion: () => {},
    getActivitySignature: () => "",
    setActivitySignature: () => {},
    setActivity: () => {},
    getMapVersion: () => "",
    setOverlaps: () => {},
    activityDiscoveryEnabled: () => false,
    fetchJson: async () => ({}) as never,
    applyMap: () => {},
    setNamedPlaces: () => {},
    rebuildActivityFog: () => {},
    render: () => {},
    setHoverText: () => {},
    ...overrides,
  };
}

test("createPollingController exposes the wiring surface app.ts consumes", () => {
  const controller = createPollingController(stubDeps());
  assert.equal(typeof controller.startActivityPolling, "function");
  assert.equal(typeof controller.startMapPolling, "function");
  assert.equal(typeof controller.handleActivityToggle, "function");
  assert.equal(typeof controller.refreshActivity, "function");
  assert.equal(typeof controller.activityRequestUrl, "function");
  assert.equal(typeof controller.activitySignature, "function");
});

test("activityRequestUrl pins the version only on a matching detail unforced", () => {
  const controller = createPollingController(
    stubDeps({ getActivityVersion: () => "v7", getActivityDetail: () => "full" }),
  );
  assert.equal(
    controller.activityRequestUrl("full"),
    "/api/activity?view=viewer&detail=full&version=v7",
  );
  // force drops the version pin.
  assert.equal(
    controller.activityRequestUrl("full", { force: true }),
    "/api/activity?view=viewer&detail=full",
  );
  // a different detail than the current one drops the version pin.
  assert.equal(
    controller.activityRequestUrl("summary"),
    "/api/activity?view=viewer&detail=summary",
  );
});
