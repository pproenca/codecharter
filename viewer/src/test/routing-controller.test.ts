import assert from "node:assert/strict";
import test from "node:test";
import {
  type RoutingControllerDeps,
  createRoutingController,
} from "../main/controllers/routing.ts";
import type { Bounds, CodecharterCodemap, MapAnnotationPlace } from "../main/render/types.ts";

type WindowStub = {
  location: { hash: string };
  history: { replaceState: (data: unknown, unused: string, url: string) => void };
};

// The routing controller reads `window.location.hash` and writes stable routes
// via `window.history.replaceState`. A minimal stub is enough — no real DOM is
// exercised by the route-token + apply-latch logic that moved into the factory.
function installWindow(hash = ""): { window: WindowStub; replaced: string[] } {
  const replaced: string[] = [];
  const window: WindowStub = {
    location: { hash },
    history: {
      replaceState(_data, _unused, url) {
        replaced.push(url);
        window.location.hash = url;
      },
    },
  };
  (globalThis as unknown as { window: WindowStub }).window = window;
  return { window, replaced };
}

function clearWindow(): void {
  delete (globalThis as unknown as { window?: unknown }).window;
}

type Recorder = {
  upserted: MapAnnotationPlace[];
  selected: MapAnnotationPlace[];
  overlayResets: number;
  zoomToBounds: Array<{ bounds: Bounds; padding: number | undefined }>;
  renders: number;
};

function stubDeps(overrides: Partial<RoutingControllerDeps> = {}): {
  deps: RoutingControllerDeps;
  recorder: Recorder;
} {
  const recorder: Recorder = {
    upserted: [],
    selected: [],
    overlayResets: 0,
    zoomToBounds: [],
    renders: 0,
  };
  const deps: RoutingControllerDeps = {
    getMap: () => null,
    getNamedPlacesById: () => new Map(),
    setDrawing: () => {},
    setSelectedTarget: () => {},
    setDraftSelection: () => {},
    controls: {
      sourceTitle: null,
      sourceOutput: null,
      inspectorTitle: null,
      inspectorSubtitle: null,
    },
    resetSelectionOverlay: () => {
      recorder.overlayResets += 1;
    },
    updateInteractionModeUi: () => {},
    updateSelectionPopover: () => {},
    setSelectionStatus: () => {},
    zoomToBounds: (bounds, padding) => {
      recorder.zoomToBounds.push({ bounds, padding });
    },
    zoomToReadableFile: () => {},
    lineRatioForLine: () => 0,
    parseLineRange: () => null,
    applySourcePanel: () => {},
    fetchSourceContext: async () => {
      throw new Error("not used");
    },
    fetchJson: async () => ({}) as never,
    setText: () => {},
    render: () => {
      recorder.renders += 1;
    },
    editing: {
      upsertNamedPlace: (place) => {
        recorder.upserted.push(place);
      },
      selectAnnotation: (annotation) => {
        recorder.selected.push(annotation);
      },
      clearAnnotationForm: () => {},
    },
    selection: {
      preview: async () => {},
    },
    ...overrides,
  };
  return { deps, recorder };
}

test("createRoutingController exposes the wiring surface app.ts consumes", () => {
  const { deps } = stubDeps();
  const controller = createRoutingController(deps);
  assert.equal(typeof controller.applyHashRoute, "function");
  assert.equal(typeof controller.syncHashRoute, "function");
  assert.equal(typeof controller.isCurrentRoute, "function");
});

test("isCurrentRoute tracks the latest route token and stales superseded ones", async () => {
  installWindow("");
  try {
    const { deps } = stubDeps();
    const controller = createRoutingController(deps);
    // No intent (empty hash, no map) leaves the sequence at its first increment.
    await controller.applyHashRoute();
    assert.equal(controller.isCurrentRoute(1), true);
    assert.equal(controller.isCurrentRoute(0), false);
    await controller.applyHashRoute();
    // A second apply bumps the sequence; the old token is now stale.
    assert.equal(controller.isCurrentRoute(2), true);
    assert.equal(controller.isCurrentRoute(1), false);
  } finally {
    clearWindow();
  }
});

test("syncHashRoute replaces the hash only when it differs and is non-empty", () => {
  const { replaced, window } = installWindow("#a");
  try {
    const { deps } = stubDeps();
    const controller = createRoutingController(deps);
    controller.syncHashRoute("");
    controller.syncHashRoute("#a");
    assert.deepEqual(replaced, []);
    controller.syncHashRoute("#b");
    assert.deepEqual(replaced, ["#b"]);
    assert.equal(window.location.hash, "#b");
  } finally {
    clearWindow();
  }
});

test("syncHashRoute is suppressed while a route is being applied", async () => {
  const { replaced } = installWindow("#/annotation/x");
  try {
    let replacedDuringApply: number | null = null;
    const annotation: MapAnnotationPlace = {
      id: "x",
      kind: "mapAnnotation",
      geometry: { bounds: { x: 0, y: 0, width: 1, height: 1 } },
    };
    const { deps } = stubDeps({
      getMap: () => ({ files: {}, folders: {} }) as CodecharterCodemap,
      getNamedPlacesById: () => new Map<string, MapAnnotationPlace>([["x", annotation]]),
    });
    const controller = createRoutingController(deps);
    // selectAnnotation runs inside applyHashRoute, while the apply latch is on; a
    // syncHashRoute fired during that window must be a no-op (no replaceState).
    deps.editing.selectAnnotation = () => {
      controller.syncHashRoute("#/map/file/abc");
      replacedDuringApply = replaced.length;
    };
    await controller.applyHashRoute();
    assert.equal(replacedDuringApply, 0, "no replaceState while applying");
    // After apply, the latch is released and syncHashRoute writes again.
    controller.syncHashRoute("#/map/file/abc");
    assert.deepEqual(replaced, ["#/map/file/abc"]);
  } finally {
    clearWindow();
  }
});

test("applyHashRoute with no map performs no focus work", async () => {
  installWindow("#/annotation/x");
  try {
    const { deps, recorder } = stubDeps({ getMap: () => null });
    const controller = createRoutingController(deps);
    await controller.applyHashRoute();
    assert.equal(recorder.overlayResets, 0);
    assert.equal(recorder.selected.length, 0);
  } finally {
    clearWindow();
  }
});

test("applyHashRoute focuses a cached annotation route through the editing controller", async () => {
  installWindow("#/annotation/cached");
  try {
    const bounds: Bounds = { x: 2, y: 3, width: 4, height: 5 };
    const annotation: MapAnnotationPlace = {
      id: "cached",
      kind: "mapAnnotation",
      geometry: { bounds },
    };
    const { deps, recorder } = stubDeps({
      getMap: () => ({ files: {}, folders: {} }) as CodecharterCodemap,
      getNamedPlacesById: () => new Map<string, MapAnnotationPlace>([["cached", annotation]]),
    });
    const controller = createRoutingController(deps);
    await controller.applyHashRoute();
    assert.deepEqual(recorder.upserted, [annotation]);
    assert.equal(recorder.overlayResets, 1);
    assert.deepEqual(recorder.zoomToBounds, [{ bounds, padding: 1.35 }]);
    assert.deepEqual(recorder.selected, [annotation]);
  } finally {
    clearWindow();
  }
});
