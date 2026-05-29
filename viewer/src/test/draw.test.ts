import assert from "node:assert/strict";
import test from "node:test";
import {
  type DrawControllerDeps,
  createDrawController,
  truncateLine,
} from "../main/render/draw.ts";
import type { Bounds, View, Viewport } from "../main/render/types.ts";

// truncateLine is the only pure helper extracted alongside the draw controller;
// the rest is canvas-bound. It clips to maxChars with a 3-char ellipsis budget.
test("truncateLine returns the text unchanged when it fits", () => {
  assert.equal(truncateLine("const x = 1;", 80), "const x = 1;");
  assert.equal(truncateLine("abc", 3), "abc");
});

test("truncateLine clips with an ellipsis when longer than maxChars", () => {
  // 9-char input, maxChars 6 -> slice(0, 3) + "..." = "abc..."
  assert.equal(truncateLine("abcdefghi", 6), "abc...");
});

test("truncateLine clamps the slice length to zero for tiny budgets", () => {
  // maxChars 2 (< text length) -> slice(0, max(0, -1)) + "..." = "..."
  assert.equal(truncateLine("abcdef", 2), "...");
});

// A recording stand-in for the 2D context: the draw controller only issues
// drawing commands, so we capture method names to prove it touched the canvas
// without a real DOM.
function recordingContext(calls: string[]): CanvasRenderingContext2D {
  return new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === "save" || prop === "restore") {
          calls.push(prop);
          return () => {};
        }
        // Stroke/fill style and similar property writes are no-ops we ignore.
        return (...args: unknown[]) => {
          calls.push(prop);
          void args;
        };
      },
      set() {
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
}

function smokeDeps(ctx: CanvasRenderingContext2D): DrawControllerDeps {
  const viewport: Viewport = { width: 800, height: 600 };
  const view: View = { x: 0, y: 0, scale: 1 };
  return {
    ctx,
    canvasSize: () => viewport,
    viewportSize: () => viewport,
    getView: () => view,
    getMapFolders: () => [],
    getMapFiles: () => [],
    getOrganicRegionFolders: () => [],
    getActivityFog: () => null,
    getNamedPlaces: () => [],
    getSelectedTarget: () => null,
    getSourceCache: () => new Map(),
    getPendingSourceRequests: () => new Set(),
    isDiscoveryEnabled: () => false,
    drawRect: (_box: Bounds) => {},
    drawLabel: () => {},
    queueLabelInBox: () => {},
    drawSelection: () => {},
    render: () => {},
    fetchJson: async () => ({}) as never,
  };
}

test("createDrawController exposes the wiring surface app.ts consumes", () => {
  const calls: string[] = [];
  const draw = createDrawController(smokeDeps(recordingContext(calls)));
  for (const name of [
    "clearCaches",
    "drawGrid",
    "drawCompassRose",
    "drawFolders",
    "drawOrganicRegions",
    "drawFiles",
    "drawNamedPlaces",
  ] as const) {
    assert.equal(typeof draw[name], "function", `expected draw.${name} to be a function`);
  }
  // clearCaches must be callable without throwing (called from applyMap).
  assert.doesNotThrow(() => draw.clearCaches());
});

test("drawCompassRose and drawGrid balance save/restore on the context", () => {
  const calls: string[] = [];
  const draw = createDrawController(smokeDeps(recordingContext(calls)));
  draw.drawCompassRose();
  draw.drawGrid();
  const saves = calls.filter((c) => c === "save").length;
  const restores = calls.filter((c) => c === "restore").length;
  assert.equal(saves, 2);
  assert.equal(restores, 2);
});

test("draw passes over empty map data without touching the context", () => {
  const calls: string[] = [];
  const draw = createDrawController(smokeDeps(recordingContext(calls)));
  draw.drawFolders();
  draw.drawOrganicRegions();
  draw.drawFiles();
  draw.drawNamedPlaces();
  assert.deepEqual(calls, []);
});
