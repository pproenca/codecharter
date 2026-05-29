import assert from "node:assert/strict";
import test from "node:test";
import {
  buildActivityFogState,
  createFogDrawer,
  discoveryFogRevealStyle,
  drawMyceliumPathForContext,
  fileFogStyle,
  fogStateForFile,
  fogStateForFolder,
  folderFogStyle,
  organicRegionFogStyle,
  shouldShowFogLabel,
} from "../main/render/fog.ts";
import type { ActivityEvent, Bounds, CodecharterCodemap, Point } from "../main/render/types.ts";

const CODEMAP: CodecharterCodemap = {
  files: { "src/a.ts": { path: "src/a.ts" }, "src/b.ts": { path: "src/b.ts" } },
  folders: { "": { path: "" }, src: { path: "src" } },
};

// viewerFogState markers classify deterministically (no time dependence):
// "visible" => visited + visible, "explored" => visited only. Unmapped paths drop.
test("buildActivityFogState classifies files and ranks ancestor folders", () => {
  const events: ActivityEvent[] = [
    { path: "src/a.ts", viewerFogState: "explored" },
    { path: "src/b.ts", viewerFogState: "visible" },
    { path: "missing.ts", viewerFogState: "visible" },
  ];
  const fog = buildActivityFogState(CODEMAP, events);

  assert.equal(fog.files.get("src/a.ts"), "explored");
  assert.equal(fog.files.get("src/b.ts"), "visible");
  assert.equal(fog.files.has("missing.ts"), false);
  assert.deepEqual([...fog.visitedFiles].toSorted(), ["src/a.ts", "src/b.ts"]);
  assert.deepEqual([...fog.visibleFiles], ["src/b.ts"]);

  // Folders take the strongest fog of any descendant: visible > explored.
  assert.equal(fog.folders.get("src"), "visible");
  assert.equal(fog.folders.get(""), "visible");
});

test("fogStateForFile resolves lookup, selected override, and defaults", () => {
  const fog = buildActivityFogState(CODEMAP, [{ path: "src/a.ts", viewerFogState: "explored" }]);

  assert.equal(fogStateForFile(fog, "src/a.ts"), "explored");
  // A file with no recorded activity is unexplored.
  assert.equal(fogStateForFile(fog, "src/b.ts"), "unexplored");
  // Selection forces visibility regardless of fog.
  assert.equal(fogStateForFile(fog, "src/b.ts", { selected: true }), "visible");
  // No fog state at all renders everything visible (fog disabled).
  assert.equal(fogStateForFile(null, "src/b.ts"), "visible");
});

test("fogStateForFolder mirrors the file resolution rules", () => {
  const fog = buildActivityFogState(CODEMAP, [{ path: "src/a.ts", viewerFogState: "explored" }]);
  assert.equal(fogStateForFolder(fog, "src"), "explored");
  assert.equal(fogStateForFolder(fog, "other"), "unexplored");
  assert.equal(fogStateForFolder(null, "other"), "visible");
});

test("shouldShowFogLabel hides only unexplored, unselected targets", () => {
  assert.equal(shouldShowFogLabel("unexplored"), false);
  assert.equal(shouldShowFogLabel("unexplored", { selected: true }), true);
  assert.equal(shouldShowFogLabel("explored"), true);
  assert.equal(shouldShowFogLabel("visible"), true);
});

test("discoveryFogRevealStyle varies with visibility and readability", () => {
  assert.equal(discoveryFogRevealStyle({ visibleFile: true, readable: true }).padding, 68);
  assert.equal(discoveryFogRevealStyle({ visibleFile: true, readable: true }).alpha, 1);
  assert.equal(discoveryFogRevealStyle({ visibleFile: true }).padding, 64);
  assert.equal(discoveryFogRevealStyle().alpha, 0.28);
});

const BASE_FOLDER_STYLE = {
  fill: "base-fill",
  stroke: "base-stroke",
  label: "base-label",
};

// discoveryMode and visible/selected pass the base style through, only retuning
// the stroke width; explored/unexplored swap to dimmed fog palettes.
test("folderFogStyle keeps base style when discovered/visible and dims otherwise", () => {
  assert.deepEqual(folderFogStyle(BASE_FOLDER_STYLE, "unexplored", 1, false, true), {
    ...BASE_FOLDER_STYLE,
    lineWidth: 2.1,
  });
  assert.deepEqual(folderFogStyle(BASE_FOLDER_STYLE, "visible", 2, true, false), {
    ...BASE_FOLDER_STYLE,
    lineWidth: 2.6,
  });
  assert.equal(
    folderFogStyle(BASE_FOLDER_STYLE, "explored", 1, false, false).fill,
    "rgba(32, 61, 48, 0.2)",
  );
  assert.equal(folderFogStyle(BASE_FOLDER_STYLE, "unexplored", 2, false, false).lineWidth, 0.8);
});

test("organicRegionFogStyle keeps base style when discovered/visible and dims otherwise", () => {
  const base = { fill: "f", stroke: "s" };
  assert.deepEqual(organicRegionFogStyle(base, "unexplored", 1, false, true), {
    ...base,
    lineWidth: 2.4,
  });
  assert.equal(
    organicRegionFogStyle(base, "explored", 1, false, false).fill,
    "rgba(42, 75, 57, 0.16)",
  );
  assert.equal(organicRegionFogStyle(base, "unexplored", 2, false, false).lineWidth, 0.9);
});

// fileFogStyle reads only the injected view scale for its lineWidth branches.
test("fileFogStyle picks palette by state and scales line width by view scale", () => {
  const selected = fileFogStyle({ fogState: "visible", selected: true, visualState: "source" }, 1);
  assert.equal(selected.stroke, "rgba(180, 84, 24, 0.95)");
  assert.equal(selected.lineWidth, 2.6);

  const visibleZoomedIn = fileFogStyle(
    { fogState: "visible", selected: false, visualState: "source" },
    3,
  );
  assert.equal(visibleZoomedIn.lineWidth, 1);
  const visibleZoomedOut = fileFogStyle(
    { fogState: "visible", selected: false, visualState: "source" },
    1,
  );
  assert.equal(visibleZoomedOut.lineWidth, 0.65);

  const unexplored = fileFogStyle(
    { fogState: "unexplored", selected: false, visualState: "aggregate" },
    5,
  );
  assert.equal(unexplored.fill, "rgba(0, 0, 0, 0.9)");
  assert.equal(unexplored.lineWidth, 0.25);
});

type PathOp = { op: "moveTo"; x: number; y: number } | { op: "bezierCurveTo"; args: number[] };

function recordingPathContext() {
  const ops: PathOp[] = [];
  const ctx = {
    ops,
    moveTo(x: number, y: number) {
      ops.push({ op: "moveTo", x, y });
    },
    bezierCurveTo(...args: number[]) {
      ops.push({ op: "bezierCurveTo", args });
    },
  };
  return ctx;
}

test("drawMyceliumPathForContext returns false for degenerate input and draws otherwise", () => {
  const empty = recordingPathContext();
  assert.equal(
    drawMyceliumPathForContext(empty as unknown as CanvasRenderingContext2D, [{ x: 0, y: 0 }], 1),
    false,
  );
  assert.equal(empty.ops.length, 0);

  const points: Point[] = [
    { x: 0, y: 0 },
    { x: 60, y: 0 },
    { x: 120, y: 40 },
    { x: 180, y: 40 },
  ];
  const drawn = recordingPathContext();
  assert.equal(
    drawMyceliumPathForContext(drawn as unknown as CanvasRenderingContext2D, points, 1),
    true,
  );
  assert.equal(drawn.ops[0]?.op, "moveTo");
  assert.ok(drawn.ops.some((entry) => entry.op === "bezierCurveTo"));
});

// Smoke test: the orchestration factory wires without DOM and exposes the shell hook.
test("createFogDrawer constructs from injected deps and exposes drawDiscoveryFogOverlay", () => {
  const noopCtx = {} as CanvasRenderingContext2D;
  const noopCanvas = { clientWidth: 0, clientHeight: 0 } as HTMLCanvasElement;
  const drawer = createFogDrawer({
    getActivityFog: () => null,
    getActivity: () => [],
    getMap: () => null,
    getViewScale: () => 1,
    ctx: noopCtx,
    canvas: noopCanvas,
    fogMaskCtx: noopCtx,
    fogMaskCanvas: noopCanvas,
    fogLayerCtx: noopCtx,
    fogLayerCanvas: noopCanvas,
    fogVeilCtx: noopCtx,
    fogVeilCanvas: noopCanvas,
    getFogVeilCacheKey: () => "",
    setFogVeilCacheKey: () => {},
    screenBounds: (bounds: Bounds) => bounds,
    visible: () => false,
    worldToScreen: (point: Point) => point,
    hashUnit: () => 0,
    integerNoise: () => 0,
    fogMaskScale: 0.5,
  });
  assert.equal(typeof drawer.drawDiscoveryFogOverlay, "function");
});
