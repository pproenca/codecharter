import test from "node:test";
import assert from "node:assert/strict";
import {
  MAP_MAX_SCALE,
  activityFragmentBounds,
  activityPrimaryBounds,
  activityStateStyle,
  activityTrailGroups,
  activityTrailPointGroups,
  activityTissueBox,
  activityVisualEncoding,
  activityActorKey,
  canRenderSourceText,
  detailBand,
  fileVisualState,
  hitTestTargets,
  isLiveActivityEvent,
  labelBoxesOverlap,
  landmarkScore,
  lineAtWorldPoint,
  maxFolderDepthForScale,
  organicRegionPoints,
  organicTrailSegments,
  latestActivityByAgent,
  normalizeMapPath,
  panViewByScreenDelta,
  screenBoundsForView,
  screenToWorldPoint,
  shouldDrawFolder,
  shouldDrawOrganicRegion,
  shouldLabelFile,
  simplifyTrailPoints,
  sourceContextRequest,
  formatSourceLines,
  sourcePanelLineRangeForBox,
  sortedActivityEvents,
  viewForBounds,
  viewForReadableFile,
  visibleLineRangeForBox,
  worldToScreenPoint,
  zoomViewAt,
} from "../public/render-model.js";

test("maps zoom scale into deterministic perceptual detail bands", () => {
  assert.equal(detailBand(1), "district");
  assert.equal(detailBand(1.8), "neighborhood");
  assert.equal(detailBand(3), "block");
  assert.equal(detailBand(7), "parcel");
  assert.equal(detailBand(12), "source");
  assert.equal(maxFolderDepthForScale(1), 1);
  assert.equal(maxFolderDepthForScale(3), 3);
});

test("gates source text rendering by readable pixel geometry", () => {
  const file = codeFile({ lineCount: 10 });

  assert.equal(canRenderSourceText(file, { width: 300, height: 150 }), true);
  assert.equal(canRenderSourceText(file, { width: 120, height: 150 }), false);
  assert.equal(canRenderSourceText(file, { width: 300, height: 90 }), false);
  assert.equal(shouldLabelFile({
    file,
    box: { width: 300, height: 150 },
    scale: 20,
    selected: true,
  }), false);
});

test("max zoom can make dense reference files readable on the canvas", () => {
  const denseReference = codeFile({ lineCount: 137 });
  const bounds = { width: 0.019130507675, height: 0.017017907493 };
  const viewport = { width: 663, height: 1324 };
  const boxAtMaxZoom = {
    width: bounds.width * viewport.width * MAP_MAX_SCALE,
    height: bounds.height * viewport.height * MAP_MAX_SCALE,
  };

  assert.equal(canRenderSourceText(denseReference, boxAtMaxZoom), true);
});

test("keeps known landmarks visible before ordinary low-signal parcels", () => {
  const landmark = codeFile({ path: "src/server.js", name: "server.js" });
  const ordinary = codeFile({ path: "src/tiny-helper.js", name: "tiny-helper.js" });

  assert.ok(landmarkScore(landmark) > landmarkScore(ordinary));
  assert.equal(fileVisualState({
    file: landmark,
    box: { width: 82, height: 28 },
    scale: 1,
    selected: false,
  }), "landmark");
  assert.equal(fileVisualState({
    file: ordinary,
    box: { width: 8, height: 700 },
    scale: 80,
    selected: false,
  }), "hidden");
});

test("collapses visual noise into aggregate parcels instead of hairline tiles", () => {
  const file = codeFile({ path: "src/narrow.js", name: "narrow.js" });

  assert.equal(fileVisualState({
    file,
    box: { width: 14, height: 30 },
    scale: 3,
    selected: false,
  }), "aggregate");
  assert.equal(shouldDrawFolder(80, 4, { width: 4, height: 900 }), false);
});

test("detects label collision with simple screen-space boxes", () => {
  assert.equal(labelBoxesOverlap(
    { x: 10, y: 10, width: 40, height: 16 },
    { x: 42, y: 18, width: 30, height: 16 },
  ), true);
  assert.equal(labelBoxesOverlap(
    { x: 10, y: 10, width: 40, height: 16 },
    { x: 80, y: 18, width: 30, height: 16 },
  ), false);
});

test("keeps camera transforms reversible across screen and world space", () => {
  const viewport = { width: 800, height: 600 };
  const view = { x: 0.2, y: 0.1, scale: 4 };
  const world = { x: 0.42, y: 0.72 };
  const screen = worldToScreenPoint(world, view, viewport);

  assert.deepEqual(roundPoint(screenToWorldPoint(screen, view, viewport)), roundPoint(world));
  assert.deepEqual(screenBoundsForView(
    { x: 0.2, y: 0.1, width: 0.1, height: 0.2 },
    view,
    viewport,
  ), { x: 0, y: 0, width: 320, height: 480 });
});

test("empirically keeps screen and world coordinate transforms precise across the viewport", () => {
  const viewport = { width: 1505, height: 1324 };
  const view = { x: -0.214987654321, y: -0.307123456789, scale: 1.372918273645 };
  let maxError = 0;
  let checked = 0;

  for (let yIndex = 0; yIndex <= 32; yIndex += 1) {
    for (let xIndex = 0; xIndex <= 32; xIndex += 1) {
      const world = {
        x: xIndex / 32,
        y: yIndex / 32,
      };
      const screen = worldToScreenPoint(world, view, viewport);
      const roundTrip = screenToWorldPoint(screen, view, viewport);
      maxError = Math.max(maxError, Math.abs(roundTrip.x - world.x), Math.abs(roundTrip.y - world.y));
      checked += 1;
    }
  }

  assert.equal(checked, 1089);
  assert.ok(maxError < 1e-12, `max transform error ${maxError}`);
});

test("zooms around the requested screen anchor without drifting the target world point", () => {
  const viewport = { width: 800, height: 600 };
  const anchor = { x: 300, y: 240 };
  const before = { x: 0.12, y: 0.16, scale: 2 };
  const worldBefore = screenToWorldPoint(anchor, before, viewport);
  const after = zoomViewAt(before, anchor, 1.8, viewport);

  assert.equal(after.scale, 3.6);
  assert.deepEqual(roundPoint(screenToWorldPoint(anchor, after, viewport)), roundPoint(worldBefore));
});

test("pans camera by screen-space deltas for wheel and keyboard navigation", () => {
  const viewport = { width: 900, height: 600 };
  const view = panViewByScreenDelta({ x: 0.1, y: 0.2, scale: 3 }, { x: 90, y: -60 }, viewport);

  assert.deepEqual(roundPoint(view), { x: 0.133333333333, y: 0.166666666667, scale: 3 });
});

test("fits bounds and readable files into a deterministic camera view", () => {
  const viewport = { width: 1000, height: 800 };
  const bounds = { x: 0.2, y: 0.25, width: 0.2, height: 0.1 };
  const view = viewForBounds(bounds, viewport, 1.25);
  const box = screenBoundsForView(bounds, view, viewport);

  assert.equal(box.width <= viewport.width, true);
  assert.equal(box.height <= viewport.height, true);

  const file = codeFile({
    lineCount: 40,
    bounds: { x: 0.5, y: 0.2, width: 0.08, height: 0.04 },
  });
  const readableView = viewForReadableFile(file, viewport, 0.75);
  const readableBox = screenBoundsForView(file.bounds, readableView, viewport);

  assert.equal(canRenderSourceText(file, readableBox), true);
});

test("derives visible source ranges and selected lines from rendered geometry", () => {
  const file = codeFile({
    lineCount: 100,
    bounds: { x: 0.2, y: 0.2, width: 0.3, height: 0.4 },
  });
  const partiallyVisibleBox = { x: 0, y: -200, width: 320, height: 1000 };

  assert.deepEqual(visibleLineRangeForBox(file, partiallyVisibleBox, 600), { start: 21, end: 80 });
  assert.equal(lineAtWorldPoint(file, { x: 0.3, y: 0.4 }), 51);
  assert.deepEqual(
    sourcePanelLineRangeForBox(file, 51, { width: 100, height: 100 }, 600),
    { start: 39, end: 75 },
  );
});

test("builds source-context requests and formats panel lines consistently", () => {
  const request = sourceContextRequest("src/app.ts", { start: 7, end: 12 });

  assert.equal(request.query, "path=src%2Fapp.ts&lineStart=7&lineEnd=12");
  assert.equal(request.resolveUrl, "/api/resolve?path=src%2Fapp.ts&lineStart=7&lineEnd=12");
  assert.equal(request.sourceUrl, "/api/source?path=src%2Fapp.ts&lineStart=7&lineEnd=12");
  assert.equal(request.lines, "7-12");
  assert.equal(formatSourceLines({
    lines: [
      { number: 7, text: "const app = true;" },
      { number: 12, text: "export default app;" },
    ],
  }), "   7  const app = true;\n  12  export default app;");
});

test("normalizes ordinary paths to sidecar map keys", () => {
  assert.equal(normalizeMapPath("."), "");
  assert.equal(normalizeMapPath("./src/"), "src");
  assert.equal(normalizeMapPath("src\\app.ts"), "src/app.ts");
});

test("hit-testing prefers the smallest containing file before enclosing folders", () => {
  const codemap = {
    folders: {
      src: target("src", "folder", { x: 0, y: 0, width: 1, height: 1 }),
    },
    files: {
      "src/a.js": target("src/a.js", "file", { x: 0.2, y: 0.2, width: 0.4, height: 0.4 }),
      "src/a-inner.js": target("src/a-inner.js", "file", { x: 0.3, y: 0.3, width: 0.1, height: 0.1 }),
    },
  };

  const hit = hitTestTargets(codemap, { x: 0.35, y: 0.35 });

  assert.equal(hit.targetType, "file");
  assert.equal(hit.path, "src/a-inner.js");
});

test("derives organic region contours deterministically from world bounds", () => {
  const bounds = { x: 0.12, y: 0.2, width: 0.32, height: 0.18 };
  const first = organicRegionPoints(bounds, "src/features", 2);
  const second = organicRegionPoints(bounds, "src/features", 2);
  const other = organicRegionPoints(bounds, "src/search", 2);

  assert.deepEqual(first, second);
  assert.notDeepEqual(first, other);
  assert.equal(first.length, 24);
  for (const point of first) {
    assert.ok(point.x >= bounds.x && point.x <= bounds.x + bounds.width);
    assert.ok(point.y >= bounds.y && point.y <= bounds.y + bounds.height);
  }
});

test("keeps organic contour sizing in projected world-space ratios", () => {
  const small = { x: 0, y: 0, width: 0.2, height: 0.1 };
  const large = { x: 0.3, y: 0.4, width: 0.4, height: 0.2 };
  const smallRatios = organicRegionPoints(small, "src", 1).map((point) => ratio(point, small));
  const largeRatios = organicRegionPoints(large, "src", 1).map((point) => ratio(point, large));

  assert.deepEqual(largeRatios, smallRatios);
  assert.equal(shouldDrawOrganicRegion(1, 1, { width: 180, height: 90 }), true);
  assert.equal(shouldDrawOrganicRegion(1, 1, { width: 60, height: 400 }), false);
  assert.equal(shouldDrawOrganicRegion(1, 5, { width: 300, height: 300 }), false);
});

test("turns activity point sequences into smooth bounded trail segments", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 2, y: 1 },
    { x: 30, y: 12 },
    { x: 80, y: 36 },
  ];

  const simplified = simplifyTrailPoints(points, 8);
  const segments = organicTrailSegments(points, { minDistance: 8 });

  assert.deepEqual(simplified, [points[0], points[2], points[3]]);
  assert.equal(segments.length, 2);
  assert.deepEqual(segments[0].start, points[0]);
  assert.deepEqual(segments.at(-1).end, points[3]);
  assert.equal(Number.isFinite(segments[0].control1.x), true);
  assert.equal(Number.isFinite(segments[0].control2.y), true);
  assert.deepEqual(organicTrailSegments(points, { minDistance: 8 }), segments);
});

test("keeps trail curve handles close to their local segment", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 1000, y: 1000 },
  ];
  const [first] = organicTrailSegments(points, { minDistance: 0 });

  assert.ok(first.control2.x >= -4 && first.control2.x <= 14);
  assert.ok(first.control2.y >= -4 && first.control2.y <= 4);
});

test("splits activity trails by Codex session and time gap", () => {
  const events = [
    activity("codex", "reading", "2026-05-20T10:00:00.000Z", { id: "a1", sessionId: "session-a" }),
    activity("codex", "editing", "2026-05-20T10:01:00.000Z", { id: "b1", sessionId: "session-b" }),
    activity("codex", "testing", "2026-05-20T10:02:00.000Z", { id: "a2", sessionId: "session-a" }),
    activity("codex", "reviewing", "2026-05-20T10:40:00.000Z", { id: "a3", sessionId: "session-a" }),
  ];

  const groups = activityTrailGroups(events, {
    maxGapMinutes: 20,
    now: Date.parse("2026-05-20T10:45:00.000Z"),
  });

  assert.deepEqual(groups.map((group) => group.map((event) => event.id)), [["a1", "a2"]]);
});

test("splits activity trail strokes before distant map jumps", () => {
  const pointGroups = activityTrailPointGroups([
    { x: 0, y: 0 },
    { x: 22, y: 4 },
    { x: 400, y: 260 },
    { x: 420, y: 262 },
  ], { maxSegmentDistance: 120 });

  assert.deepEqual(pointGroups, [
    [{ x: 0, y: 0 }, { x: 22, y: 4 }],
    [{ x: 400, y: 260 }, { x: 420, y: 262 }],
  ]);
});

test("sorts activity events and keeps the latest visible state by agent", () => {
  const now = Date.parse("2026-05-20T12:00:00.000Z");
  const events = [
    activity("codex", "reading", "2026-05-20T10:00:00.000Z"),
    activity("reviewer", "testing", "2026-05-20T10:01:00.000Z"),
    activity("codex", "editing", "2026-05-20T10:02:00.000Z"),
  ];

  assert.deepEqual(sortedActivityEvents(events, 2, { now }).map((event) => event.activityState), ["testing", "editing"]);
  assert.equal(latestActivityByAgent(events, { now }).get("codex:manual").activityState, "editing");
  assert.equal(activityStateStyle("reviewing").fill, "#f59e0b");
  assert.equal(activityStateStyle("blocked").fill, activityStateStyle("reviewing").fill);
});

test("keeps latest activity separately for each Codex thread", () => {
  const now = Date.parse("2026-05-20T12:00:00.000Z");
  const events = [
    activity("codex", "reading", "2026-05-20T10:00:00.000Z", { threadId: "thread-a" }),
    activity("codex", "editing", "2026-05-20T10:01:00.000Z", { threadId: "thread-b" }),
    activity("codex", "testing", "2026-05-20T10:02:00.000Z", { threadId: "thread-a" }),
  ];

  const latest = latestActivityByAgent(events, { now });
  assert.equal(activityActorKey(events[0]), "codex:thread-a");
  assert.equal(latest.size, 2);
  assert.equal(latest.get("codex:thread-a").activityState, "testing");
  assert.equal(latest.get("codex:thread-b").activityState, "editing");
});

test("encodes activity as recency-faded biological markers", () => {
  const now = Date.parse("2026-05-20T12:00:00.000Z");
  const fresh = activityVisualEncoding(activity("codex", "editing", "2026-05-20T12:00:00.000Z"), { latest: true, now });
  const dormantLatest = activityVisualEncoding(activity("codex", "editing", "2026-05-20T11:20:00.000Z"), { latest: true, now });
  const older = activityVisualEncoding(activity("codex", "editing", "2026-05-20T09:00:00.000Z"), { latest: false, now });
  const selected = activityVisualEncoding(activity("codex", "blocked", "2026-05-20T09:00:00.000Z"), { selected: true, now });

  assert.equal(fresh.activityState, "editing");
  assert.equal(selected.activityState, "reviewing");
  assert.equal(fresh.active, true);
  assert.equal(dormantLatest.dormant, true);
  assert.equal(dormantLatest.active, false);
  assert.equal(fresh.alpha > older.alpha, true);
  assert.equal(fresh.alpha > dormantLatest.alpha, true);
  assert.equal(fresh.haloRadius > dormantLatest.haloRadius, true);
  assert.equal(dormantLatest.trailAlpha < fresh.trailAlpha, true);
  assert.equal(selected.haloRadius > fresh.haloRadius, true);
  assert.equal(fresh.coreRadius > older.coreRadius, true);
});

test("treats activity as ephemeral live tissue before archival history", () => {
  const now = Date.parse("2026-05-20T12:00:00.000Z");
  const fresh = activity("codex", "editing", "2026-05-20T11:55:00.000Z");
  const expired = activity("codex", "editing", "2026-05-20T04:00:00.000Z");

  assert.equal(isLiveActivityEvent(fresh, { now }), true);
  assert.equal(isLiveActivityEvent(expired, { now }), false);
  assert.deepEqual(sortedActivityEvents([expired, fresh], 10, { now }).map((event) => event.timestamp), [fresh.timestamp]);
  assert.equal(activityVisualEncoding(expired, { now }).alpha, 0);
});

test("expands precise token activity into a visible tissue patch", () => {
  const box = activityTissueBox({ x: 20, y: 40, width: 2, height: 3 }, {});
  assert.equal(box.width, 18);
  assert.equal(box.height, 10);
  assert.equal(box.x, 12);
  assert.equal(box.y, 36.5);

  const selected = activityTissueBox({ x: 20, y: 40, width: 2, height: 3 }, { selected: true });
  assert.equal(selected.width, 30);
  assert.equal(selected.height, 18);
});

test("anchors activity to text-bearing fragments instead of the aggregate bounds", () => {
  const event = activity("codex", "editing", "2026-05-20T12:00:00.000Z");
  event.address.bounds = { x: 0.2, y: 0.2, width: 0.6, height: 0.4 };
  event.address.fragments = [
    { bounds: { x: 0.21, y: 0.22, width: 0.05, height: 0.01 } },
    { bounds: { x: 0.62, y: 0.58, width: 0.08, height: 0.01 } },
  ];

  assert.deepEqual(activityPrimaryBounds(event), event.address.fragments[0].bounds);
  assert.deepEqual(activityFragmentBounds(event), event.address.fragments.map((fragment) => fragment.bounds));
});

function codeFile(overrides = {}) {
  return {
    path: "src/app.js",
    name: "app.js",
    lineCount: 24,
    ...overrides,
  };
}

function activity(agentId, activityState, timestamp, overrides = {}) {
  return {
    id: `${agentId}-${activityState}`,
    agentId,
    activityState,
    timestamp,
    address: {
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      geohash: "s000000",
      deepLink: "codecharter://file/s000000?path=src%2Fapp.ts",
    },
    ...overrides,
  };
}

function target(path, targetType, bounds) {
  return {
    path,
    name: path.split("/").at(-1),
    targetType,
    bounds,
    geo: { geohash: "s00000000000", lat: 0, lon: 0 },
    lineCount: 10,
    weight: 10,
  };
}

function roundPoint(point) {
  return Object.fromEntries(
    Object.entries(point).map(([key, value]) => [key, Number(value.toFixed(12))]),
  );
}

function ratio(point, bounds) {
  return {
    x: Number(((point.x - bounds.x) / bounds.width).toFixed(12)),
    y: Number(((point.y - bounds.y) / bounds.height).toFixed(12)),
  };
}
