import assert from "node:assert/strict";
import test from "node:test";
import {
  activityActorKey,
  activityActorLabel,
  activityFragmentBounds,
  activityPrimaryBounds,
  activityStateStyle,
  isLiveActivityEvent,
  latestActivityByAgent,
  normalizeActivityState,
  shortActivityId,
  simplifyTrailPoints,
} from "../main/render/activity.ts";
import type { ActivityEvent, Bounds } from "../main/render/types.ts";

const BOX: Bounds = { x: 0, y: 0, width: 0.1, height: 0.1 };
const NOW = Date.parse("2026-05-29T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

test("activityActorKey falls back agent->'agent', thread->session->'manual'", () => {
  assert.equal(activityActorKey({ agentId: "codex", threadId: "t1" }), "codex:t1");
  assert.equal(activityActorKey({ agentId: "codex", sessionId: "s1" }), "codex:s1");
  assert.equal(activityActorKey({}), "agent:manual");
});

test("shortActivityId truncates to 8 chars", () => {
  assert.equal(shortActivityId("0123456789abcdef"), "01234567");
  assert.equal(shortActivityId("short"), "short");
});

test("activityActorLabel combines agent + short thread id", () => {
  assert.equal(activityActorLabel({ agentId: "codex", threadId: "0123456789" }), "codex 01234567");
  assert.equal(activityActorLabel({ agentId: "codex" }), "codex");
  assert.equal(activityActorLabel({}), "agent");
});

test("normalizeActivityState maps blocked->reviewing and unknown->reading", () => {
  assert.equal(normalizeActivityState("blocked"), "reviewing");
  assert.equal(normalizeActivityState("editing"), "editing");
  assert.equal(normalizeActivityState("nonsense"), "reading");
  assert.equal(normalizeActivityState(undefined), "reading");
  // activityStateStyle resolves through the same normalization.
  assert.equal(activityStateStyle("blocked"), activityStateStyle("reviewing"));
});

test("activityFragmentBounds prefers fragments, falls back to address bounds, else []", () => {
  const b2: Bounds = { x: 1, y: 1, width: 1, height: 1 };
  assert.deepEqual(
    activityFragmentBounds({ address: { fragments: [{ bounds: BOX }, { bounds: b2 }] } }),
    [BOX, b2],
  );
  assert.deepEqual(activityFragmentBounds({ address: { fragments: [{}], bounds: BOX } }), [BOX]);
  assert.deepEqual(activityFragmentBounds({ address: { bounds: BOX } }), [BOX]);
  assert.deepEqual(activityFragmentBounds({}), []);
});

test("activityPrimaryBounds: first fragment bounds, else address bounds, else null", () => {
  assert.deepEqual(activityPrimaryBounds({ address: { fragments: [{ bounds: BOX }] } }), BOX);
  assert.deepEqual(activityPrimaryBounds({ address: { bounds: BOX } }), BOX);
  assert.equal(activityPrimaryBounds({}), null);
});

test("simplifyTrailPoints keeps endpoints and drops sub-threshold points", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 1, y: 1 }, // ~1.41px from start, below threshold -> dropped
    { x: 100, y: 100 },
  ];
  assert.deepEqual(simplifyTrailPoints(points, 10), [
    { x: 0, y: 0 },
    { x: 100, y: 100 },
  ]);
  // <= 2 points pass through unchanged.
  assert.deepEqual(simplifyTrailPoints([{ x: 0, y: 0 }], 10), [{ x: 0, y: 0 }]);
});

test("isLiveActivityEvent needs bounds and an age within the window", () => {
  const recent: ActivityEvent = { address: { bounds: BOX }, timestamp: minutesAgo(5) };
  const stale: ActivityEvent = { address: { bounds: BOX }, timestamp: minutesAgo(60) };
  const noBounds: ActivityEvent = { timestamp: minutesAgo(1) };
  assert.equal(isLiveActivityEvent(recent, { now: NOW, maxAgeMinutes: 10 }), true);
  assert.equal(isLiveActivityEvent(stale, { now: NOW, maxAgeMinutes: 10 }), false);
  assert.equal(isLiveActivityEvent(noBounds, { now: NOW, maxAgeMinutes: 10 }), false);
});

test("latestActivityByAgent keeps the newest live event per actor", () => {
  const e1: ActivityEvent = {
    agentId: "codex",
    threadId: "t1",
    address: { bounds: BOX },
    timestamp: minutesAgo(5),
  };
  const e2: ActivityEvent = {
    agentId: "codex",
    threadId: "t1",
    address: { bounds: BOX },
    timestamp: minutesAgo(2),
  };
  const e3: ActivityEvent = {
    agentId: "claude",
    threadId: "t2",
    address: { bounds: BOX },
    timestamp: minutesAgo(10),
  };
  const latest = latestActivityByAgent([e1, e2, e3], { now: NOW, maxAgeMinutes: 15 });
  assert.equal(latest.size, 2);
  assert.equal(latest.get("codex:t1"), e2);
  assert.equal(latest.get("claude:t2"), e3);
});
