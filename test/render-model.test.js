import test from "node:test";
import assert from "node:assert/strict";
import {
  canRenderSourceText,
  detailBand,
  fileVisualState,
  labelBoxesOverlap,
  landmarkScore,
  maxFolderDepthForScale,
  shouldDrawAggregateHint,
  shouldDrawFolder,
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

test("collapses visual noise into aggregate hints instead of hairline tiles", () => {
  const file = codeFile({ path: "src/narrow.js", name: "narrow.js" });

  assert.equal(fileVisualState({
    file,
    box: { width: 14, height: 30 },
    scale: 3,
    selected: false,
  }), "aggregate");
  assert.equal(shouldDrawFolder(80, 4, { width: 4, height: 900 }), false);
  assert.equal(shouldDrawAggregateHint({
    scale: 1,
    depth: 1,
    box: { width: 220, height: 100 },
    childCount: 8,
  }), true);
  assert.equal(shouldDrawAggregateHint({
    scale: 1,
    depth: 1,
    box: { width: 220, height: 100 },
    childCount: 2,
  }), false);
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

function codeFile(overrides = {}) {
  return {
    path: "src/app.js",
    name: "app.js",
    lineCount: 24,
    ...overrides,
  };
}
