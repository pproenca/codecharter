import test from "node:test";
import assert from "node:assert/strict";
import {
  MAP_MAX_SCALE,
  canRenderSourceText,
  detailBand,
  fileVisualState,
  labelBoxesOverlap,
  landmarkScore,
  maxFolderDepthForScale,
  organicRegionPoints,
  shouldDrawFolder,
  shouldDrawOrganicRegion,
  shouldLabelFile,
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

function codeFile(overrides = {}) {
  return {
    path: "src/app.js",
    name: "app.js",
    lineCount: 24,
    ...overrides,
  };
}

function ratio(point, bounds) {
  return {
    x: Number(((point.x - bounds.x) / bounds.width).toFixed(12)),
    y: Number(((point.y - bounds.y) / bounds.height).toFixed(12)),
  };
}
