import assert from "node:assert/strict";
import test from "node:test";
import { type SearchControllerDeps, createSearchController } from "../main/controllers/search.ts";
import type {
  Bounds,
  CodecharterMap,
  MapFile,
  MapFolder,
  TargetHit,
} from "../main/render/types.ts";

type Recorder = {
  selectedTargets: Array<TargetHit | null>;
  searchResults: string[];
  zoomToBounds: Array<{ bounds: Bounds; padding: number | undefined }>;
  zoomToReadableFile: MapFile[];
  selectMapTarget: Array<{ x: number; y: number }>;
  renders: number;
};

// The search controller is DOM glue over the pure match/action helpers. A minimal
// stub set lets us drive each focus branch deterministically without a real DOM;
// the match/action logic itself lives in the unit-tested render-model helpers.
function stubDeps(overrides: Partial<SearchControllerDeps> = {}): {
  deps: SearchControllerDeps;
  recorder: Recorder;
} {
  const recorder: Recorder = {
    selectedTargets: [],
    searchResults: [],
    zoomToBounds: [],
    zoomToReadableFile: [],
    selectMapTarget: [],
    renders: 0,
  };
  const deps: SearchControllerDeps = {
    getMap: () => null,
    getNamedPlaces: () => [],
    setSelectedTarget: (target) => {
      recorder.selectedTargets.push(target as TargetHit | null);
    },
    controls: {
      searchInput: null,
      searchResult: null,
      inspectorTitle: null,
      inspectorSubtitle: null,
    },
    zoomToBounds: (bounds, padding) => {
      recorder.zoomToBounds.push({ bounds, padding });
    },
    zoomToReadableFile: (file) => {
      recorder.zoomToReadableFile.push(file);
    },
    selectMapTarget: async (point) => {
      recorder.selectMapTarget.push({ x: point.x, y: point.y });
    },
    render: () => {
      recorder.renders += 1;
    },
    setText: () => {},
    editing: {
      selectedAnnotation: () => null,
      selectAnnotation: () => {},
    },
    ...overrides,
  };
  return { deps, recorder };
}

test("createSearchController exposes the wiring surface app.ts consumes", () => {
  const { deps } = stubDeps();
  const controller = createSearchController(deps);
  assert.equal(typeof controller.handleSubmit, "function");
});

test("handleSubmit no-ops on an empty query without touching the camera", async () => {
  let prevented = false;
  const { deps, recorder } = stubDeps({
    getMap: () => ({ files: {}, folders: {} }) as CodecharterMap,
    controls: {
      searchInput: { value: "   " } as HTMLElement & { value?: string },
      searchResult: null,
      inspectorTitle: null,
      inspectorSubtitle: null,
    },
  });
  const controller = createSearchController(deps);
  await controller.handleSubmit({
    preventDefault: () => {
      prevented = true;
    },
  } as Event);
  assert.equal(prevented, true);
  assert.equal(recorder.zoomToBounds.length, 0);
  assert.equal(recorder.selectedTargets.length, 0);
});

test("handleSubmit no-ops when there is no map", async () => {
  let prevented = false;
  const { deps, recorder } = stubDeps({
    getMap: () => null,
    controls: {
      searchInput: { value: "anything" } as HTMLElement & { value?: string },
      searchResult: null,
      inspectorTitle: null,
      inspectorSubtitle: null,
    },
  });
  const controller = createSearchController(deps);
  await controller.handleSubmit({
    preventDefault: () => {
      prevented = true;
    },
  } as Event);
  assert.equal(prevented, true);
  assert.equal(recorder.zoomToBounds.length, 0);
});

test("handleSubmit focuses a matching folder by name through the camera + selection", async () => {
  const bounds: Bounds = { x: 1, y: 2, width: 3, height: 4 };
  const folder: MapFolder = {
    name: "src",
    path: "src",
    bounds,
    geo: { geohash: "abc" },
  } as unknown as MapFolder;
  const map = {
    files: {},
    folders: { src: folder },
  } as unknown as CodecharterMap;
  const { deps, recorder } = stubDeps({
    getMap: () => map,
    controls: {
      searchInput: { value: "src" } as HTMLElement & { value?: string },
      searchResult: null,
      inspectorTitle: null,
      inspectorSubtitle: null,
    },
  });
  const controller = createSearchController(deps);
  await controller.handleSubmit({ preventDefault: () => {} } as Event);
  // A folder match zooms with the 1.6 padding and selects a folder target.
  assert.deepEqual(recorder.zoomToBounds, [{ bounds, padding: 1.6 }]);
  assert.equal(recorder.selectedTargets.length, 1);
  const selected = recorder.selectedTargets[0];
  assert.equal((selected as TargetHit & { targetType?: string })?.targetType, "folder");
  assert.equal(recorder.renders, 1);
});
