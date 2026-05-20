import test from "node:test";
import assert from "node:assert/strict";
import {
  MAP_MAX_SCALE,
  activityStateStyle,
  canRenderSourceText,
  detailBand,
  fileVisualState,
  hitTestTargets,
  labelBoxesOverlap,
  landmarkScore,
  lineAtWorldPoint,
  maxFolderDepthForScale,
  organicRegionPoints,
  latestActivityByAgent,
  panViewByScreenDelta,
  screenBoundsForView,
  screenToWorldPoint,
  shouldDrawFolder,
  shouldDrawOrganicRegion,
  shouldLabelFile,
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

test("sorts activity events and keeps the latest visible state by agent", () => {
  const events = [
    activity("codex", "reading", "2026-05-20T10:00:00.000Z"),
    activity("reviewer", "testing", "2026-05-20T10:01:00.000Z"),
    activity("codex", "editing", "2026-05-20T10:02:00.000Z"),
  ];

  assert.deepEqual(sortedActivityEvents(events, 2).map((event) => event.activityState), ["testing", "editing"]);
  assert.equal(latestActivityByAgent(events).get("codex").activityState, "editing");
  assert.equal(activityStateStyle("blocked").fill, "#f59e0b");
});

function codeFile(overrides = {}) {
  return {
    path: "src/app.js",
    name: "app.js",
    lineCount: 24,
    ...overrides,
  };
}

function activity(agentId, activityState, timestamp) {
  return {
    id: `${agentId}-${activityState}`,
    agentId,
    activityState,
    timestamp,
    address: {
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      geohash: "s000000",
      deepLink: "codemap://file/s000000?path=src%2Fapp.ts",
    },
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
