import assert from "node:assert/strict";
import test from "node:test";
import {
  type InspectionControllerDeps,
  createInspectionController,
} from "../main/controllers/inspection.ts";
import type {
  Bounds,
  MapFile,
  SourceRange,
  TargetHit,
  View,
  Viewport,
} from "../main/render/types.ts";

type TextWrite = { element: HTMLElement | null; value: string };
type SourcePanelWrite = { sourceTitle: string; sourceOutput: string; scrollTop?: number };

type Recorder = {
  selectedTargets: Array<TargetHit | null>;
  texts: TextWrite[];
  sourcePanels: SourcePanelWrite[];
  hashRoutes: string[];
  renders: number;
  popovers: number;
  clearPendingDelete: number;
  clearAnnotationForm: number;
};

// The inspection controller is DOM glue over the pure selection-panel/source
// helpers. A minimal stub set drives each branch deterministically without a
// real DOM; the panel/source/line-range logic itself lives in unit-tested
// render-model helpers.
function stubDeps(overrides: Partial<InspectionControllerDeps> = {}): {
  deps: InspectionControllerDeps;
  recorder: Recorder;
} {
  const recorder: Recorder = {
    selectedTargets: [],
    texts: [],
    sourcePanels: [],
    hashRoutes: [],
    renders: 0,
    popovers: 0,
    clearPendingDelete: 0,
    clearAnnotationForm: 0,
  };
  const view: View = { x: 0, y: 0, scale: 1 };
  const viewport: Viewport = { width: 800, height: 600 };
  const deps: InspectionControllerDeps = {
    getMap: () => null,
    setSelectedTarget: (target) => {
      recorder.selectedTargets.push(target as TargetHit | null);
    },
    controls: {
      inspectorTitle: null,
      inspectorSubtitle: null,
      sourceTitle: null,
      sourceOutput: null,
    },
    setText: (element, value) => {
      recorder.texts.push({ element, value });
    },
    render: () => {
      recorder.renders += 1;
    },
    applySourcePanel: (panel) => {
      recorder.sourcePanels.push(panel);
    },
    fetchJson: async () => ({}) as never,
    viewportSize: () => viewport,
    canvasClientHeight: () => 600,
    screenBounds: (bounds) => bounds,
    zoomToBounds: () => {},
    zoomToReadableFile: () => view,
    lineRatioForLine: () => 0.5,
    updateSelectionPopover: () => {
      recorder.popovers += 1;
    },
    syncHashRoute: (hash) => {
      recorder.hashRoutes.push(hash);
    },
    editing: {
      clearPendingDelete: () => {
        recorder.clearPendingDelete += 1;
      },
      clearAnnotationForm: () => {
        recorder.clearAnnotationForm += 1;
      },
      selectAnnotation: () => {},
    },
    ...overrides,
  };
  return { deps, recorder };
}

test("createInspectionController exposes the wiring surface app.ts consumes", () => {
  const { deps } = stubDeps();
  const controller = createInspectionController(deps);
  assert.equal(typeof controller.handleMapTargetSelectionAction, "function");
  assert.equal(typeof controller.clearMapSelection, "function");
  assert.equal(typeof controller.inspectMapTarget, "function");
  assert.equal(typeof controller.inspectFolderTarget, "function");
  assert.equal(typeof controller.inspectFileTarget, "function");
  assert.equal(typeof controller.selectActivityEvent, "function");
  assert.equal(typeof controller.fetchSourceContext, "function");
  assert.equal(typeof controller.sourcePanelLineRange, "function");
});

test("clearMapSelection clears the target, resets the panels, and re-renders", () => {
  const { deps, recorder } = stubDeps();
  const controller = createInspectionController(deps);
  controller.clearMapSelection();
  assert.equal(recorder.clearPendingDelete, 1);
  assert.deepEqual(recorder.selectedTargets, [null]);
  assert.equal(recorder.popovers, 1);
  assert.equal(recorder.renders, 1);
});

test("inspectFolderTarget selects the folder and writes a map hash route", () => {
  const bounds: Bounds = { x: 1, y: 2, width: 3, height: 4 };
  const folder = {
    targetType: "folder",
    name: "src",
    path: "src",
    bounds,
    geo: { geohash: "abc" },
  } as unknown as TargetHit;
  const { deps, recorder } = stubDeps();
  const controller = createInspectionController(deps);
  controller.inspectFolderTarget(folder);
  assert.equal(recorder.clearPendingDelete, 1);
  assert.equal(recorder.clearAnnotationForm, 1);
  assert.equal(recorder.selectedTargets.length, 1);
  assert.equal(
    (recorder.selectedTargets[0] as TargetHit & { targetType?: string })?.targetType,
    "folder",
  );
  assert.equal(recorder.hashRoutes.length, 1);
  assert.equal(recorder.renders, 1);
});

test("fetchSourceContext resolves the address + source from the two request urls", async () => {
  const address = { targetType: "file", geohash: "g", deepLink: "codecharter://file?path=a.ts" };
  const source: SourceRange = { path: "a.ts" } as unknown as SourceRange;
  const requested: string[] = [];
  const { deps } = stubDeps({
    fetchJson: async <T>(url: string): Promise<T> => {
      requested.push(url);
      return (url.includes("resolve") ? address : source) as T;
    },
  });
  const controller = createInspectionController(deps);
  const [resolvedAddress, resolvedSource] = await controller.fetchSourceContext({
    query: "x=1",
    resolveUrl: "/api/resolve?x=1",
    sourceUrl: "/api/source?x=1",
    lines: "1-2",
  });
  assert.deepEqual(requested, ["/api/resolve?x=1", "/api/source?x=1"]);
  assert.deepEqual(resolvedAddress, address);
  assert.deepEqual(resolvedSource, source);
});

test("inspectFileTarget no-ops when the file has no bounds", async () => {
  const file = { targetType: "file", path: "a.ts" } as unknown as MapFile & {
    targetType: "file";
  };
  const { deps, recorder } = stubDeps();
  const controller = createInspectionController(deps);
  await controller.inspectFileTarget(file, { x: 0, y: 0 });
  assert.equal(recorder.selectedTargets.length, 0);
  assert.equal(recorder.sourcePanels.length, 0);
  assert.equal(recorder.renders, 0);
});

test("handleMapTargetSelectionAction routes clearSelection to clearMapSelection", async () => {
  const { deps, recorder } = stubDeps();
  const controller = createInspectionController(deps);
  await controller.handleMapTargetSelectionAction(
    { type: "clearSelection" } as Parameters<typeof controller.handleMapTargetSelectionAction>[0],
    null,
    { x: 0, y: 0 },
  );
  assert.deepEqual(recorder.selectedTargets, [null]);
  assert.equal(recorder.renders, 1);
});
