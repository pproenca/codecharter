import assert from "node:assert/strict";
import test from "node:test";
import {
  canvasKeyboardAction,
  documentKeyboardAction,
  doubleClickMapAction,
  draftSelectionFromDrag,
  isScreenBoxVisible,
  isUsableDraftSelection,
  labelBoxesOverlap,
  mapTargetSelectionAction,
  panViewByScreenDelta,
  screenToWorldPoint,
  viewForBounds,
  worldToScreenPoint,
  zoomViewAt,
} from "../main/render/camera.ts";
import type { View, Viewport } from "../main/render/types.ts";

const VIEWPORT: Viewport = { width: 100, height: 100 };
const ORIGIN_VIEW: View = { x: 0, y: 0, scale: 1 };

// world <-> screen are exact inverses for any view (BR coordinate contract).
test("worldToScreenPoint and screenToWorldPoint round-trip", () => {
  const view: View = { x: 0.2, y: 0.3, scale: 2 };
  const world = { x: 0.55, y: 0.42 };
  const screen = worldToScreenPoint(world, view, VIEWPORT);
  const back = screenToWorldPoint(screen, view, VIEWPORT);
  assert.ok(Math.abs(back.x - world.x) < 1e-9);
  assert.ok(Math.abs(back.y - world.y) < 1e-9);
});

// Zooming keeps the world point under the screen anchor fixed (anchored zoom).
test("zoomViewAt keeps the anchored world point stationary", () => {
  const anchor = { x: 50, y: 50 };
  const zoomed = zoomViewAt(ORIGIN_VIEW, anchor, 2, VIEWPORT);
  assert.equal(zoomed.scale, 2);
  const world = screenToWorldPoint(anchor, zoomed, VIEWPORT);
  assert.ok(Math.abs(world.x - 0.5) < 1e-9);
  assert.ok(Math.abs(world.y - 0.5) < 1e-9);
});

// BR-019: scale is clamped to the provided bounds.
test("zoomViewAt clamps scale to the max bound", () => {
  const zoomed = zoomViewAt(ORIGIN_VIEW, { x: 0, y: 0 }, 1000, VIEWPORT, 0.5, 4);
  assert.equal(zoomed.scale, 4);
});

test("panViewByScreenDelta shifts the view by delta / (viewport * scale)", () => {
  const panned = panViewByScreenDelta({ x: 0, y: 0, scale: 2 }, { x: 100, y: 50 }, VIEWPORT);
  assert.ok(Math.abs(panned.x - 0.5) < 1e-9); // 100 / (100 * 2)
  assert.ok(Math.abs(panned.y - 0.25) < 1e-9); // 50 / (100 * 2)
});

test("viewForBounds centers the bounds and applies a fit scale", () => {
  const view = viewForBounds({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, VIEWPORT, 1, 0.5, 8);
  assert.equal(view.scale, 2); // 1 / 0.5
  assert.ok(Math.abs(view.x - 0.25) < 1e-9);
  assert.ok(Math.abs(view.y - 0.25) < 1e-9);
});

test("canvasKeyboardAction maps navigation keys", () => {
  assert.deepEqual(canvasKeyboardAction({ key: "ArrowRight" }), {
    type: "pan",
    delta: { x: 72, y: 0 }, // KEYBOARD_PAN_PIXELS
  });
  assert.deepEqual(canvasKeyboardAction({ key: "+" }), { type: "zoomIn" });
  assert.deepEqual(canvasKeyboardAction({ key: "-" }), { type: "zoomOut" });
  assert.deepEqual(canvasKeyboardAction({ key: "0" }), { type: "fitCodebase" });
  assert.deepEqual(canvasKeyboardAction({ key: "Enter" }), { type: "selectCenter" });
  assert.equal(canvasKeyboardAction({ key: "a" }), null);
});

test("documentKeyboardAction respects modifiers and context", () => {
  assert.deepEqual(documentKeyboardAction({ code: "Space" }), { type: "startSpacePan" });
  // Text entry suppresses the space-pan shortcut.
  assert.equal(documentKeyboardAction({ code: "Space" }, { textEntry: true }), null);
  assert.deepEqual(documentKeyboardAction({ key: "Escape" }), { type: "cancelInteraction" });
  assert.deepEqual(
    documentKeyboardAction({ key: "Enter", metaKey: true }, { hasResolvedSelection: true }),
    { type: "saveSelection" },
  );
  assert.deepEqual(
    documentKeyboardAction({ key: "c", metaKey: true }, { hasSelectedAnnotation: true }),
    { type: "copyAnnotationPrompt" },
  );
  assert.deepEqual(documentKeyboardAction({ key: "Backspace" }, { hasSelectedAnnotation: true }), {
    type: "deleteAnnotation",
  });
  // Without a selected annotation, delete does nothing.
  assert.equal(documentKeyboardAction({ key: "Backspace" }), null);
});

test("map target actions map per target type", () => {
  assert.deepEqual(doubleClickMapAction({ targetType: "file" }), { type: "selectFile" });
  assert.deepEqual(doubleClickMapAction({ targetType: "folder" }), { type: "selectFolder" });
  assert.equal(doubleClickMapAction(null), null);

  assert.deepEqual(mapTargetSelectionAction(null), { type: "clearSelection" });
  assert.deepEqual(mapTargetSelectionAction({ targetType: "file" }), { type: "inspectFile" });
  assert.deepEqual(mapTargetSelectionAction({ targetType: "folder" }), { type: "inspectFolder" });
  assert.deepEqual(mapTargetSelectionAction({ targetType: "annotation" }), {
    type: "focusAnnotation",
  });
});

test("draft selection requires a minimum on-screen size", () => {
  const draft = draftSelectionFromDrag({ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 });
  assert.deepEqual(draft.bounds, { x: 0.1, y: 0.1, width: 0.1, height: 0.1 });
  // 0.1 * 100 * 1 = 10px >= 4px minimum.
  assert.equal(isUsableDraftSelection(draft, { viewport: VIEWPORT, scale: 1 }), true);
  const tiny = draftSelectionFromDrag({ x: 0.1, y: 0.1 }, { x: 0.11, y: 0.11 });
  // 0.01 * 100 * 1 = 1px < 4px minimum.
  assert.equal(isUsableDraftSelection(tiny, { viewport: VIEWPORT, scale: 1 }), false);
});

test("box geometry helpers", () => {
  assert.equal(
    labelBoxesOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 }),
    true,
  );
  assert.equal(
    labelBoxesOverlap({ x: 0, y: 0, width: 4, height: 4 }, { x: 5, y: 5, width: 4, height: 4 }),
    false,
  );
  assert.equal(isScreenBoxVisible({ x: -5, y: -5, width: 10, height: 10 }, VIEWPORT), true);
  assert.equal(isScreenBoxVisible({ x: 200, y: 0, width: 10, height: 10 }, VIEWPORT), false);
});
