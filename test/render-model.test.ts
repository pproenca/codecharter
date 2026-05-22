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
  activityFeedEvents,
  annotationClipboardText,
  buildActivityFogState,
  cachedSourceRange,
  canRenderSourceText,
  detailBand,
  draftSelectionFromDrag,
  fileVisualState,
  fogStateForFile,
  fogStateForFolder,
  folderDepth,
  folderDisplayName,
  folderStyle,
  hitTestTargets,
  hashRouteFocusIntent,
  interactionModeUiState,
  isUsableDraftSelection,
  canvasKeyboardAction,
  documentKeyboardAction,
  discoveryFogRevealStyle,
  discoveryFogVeilStyle,
  doubleClickMapAction,
  isLiveActivityEvent,
  labelBoxesOverlap,
  landmarkScore,
  lineAtWorldPoint,
  mapRouteFocusAction,
  mapRouteTarget,
  mapSearchAction,
  mapSearchMatch,
  mapSelectionPanel,
  mapTargetSelectionAction,
  mapHoverLabel,
  maxFolderDepthForScale,
  organicRegionStyle,
  organicRegionFolders,
  organicRegionPoints,
  organicTrailSegments,
  panViewForDrag,
  latestActivityByAgent,
  normalizeMapPath,
  panViewByScreenDelta,
  screenBoundsForView,
  screenToWorldPoint,
  shouldDrawFolder,
  shouldDrawOrganicRegion,
  shouldLabelFoggedFile,
  shouldLabelFile,
  simplifyTrailPoints,
  shouldShowFogLabel,
  shouldShowFogSourceText,
  rememberSourceRange,
  reconciledSelectedTarget,
  sourceContextRequest,
  sourceTextLayoutForBox,
  sourcePanelState,
  sourceRangeCacheKey,
  formatSourceLines,
  hitTestActivityEvents,
  hitTestAnnotations,
  sourcePanelLineRangeForBox,
  sortedActivityEvents,
  viewForBounds,
  viewForReadableFile,
  visibleLineRangeForBox,
  worldToScreenPoint,
  zoomViewAt,
} from "../public-src/render-model.ts";

const hitTestActivityEventsForTest = hitTestActivityEvents as (
  events: unknown[],
  point: { x: number; y: number },
  options?: { radiusX?: number; radiusY?: number; now?: number; maxAgeMinutes?: number },
) => ReturnType<typeof hitTestActivityEvents>;

test("maps zoom scale into deterministic perceptual detail bands", () => {
  assert.equal(detailBand(1), "district");
  assert.equal(detailBand(1.8), "neighborhood");
  assert.equal(detailBand(3), "block");
  assert.equal(detailBand(7), "parcel");
  assert.equal(detailBand(12), "source");
  assert.equal(maxFolderDepthForScale(1), 1);
  assert.equal(maxFolderDepthForScale(3), 3);
});

test("orders organic region folders by depth and path without the root", () => {
  const codemap = {
    folders: {
      "src/z": { path: "src/z" },
      "src": { path: "src" },
      "": { path: "" },
      "src/a": { path: "src/a" },
      "docs": { path: "docs" },
    },
  };

  assert.deepEqual(organicRegionFolders(codemap).map(({ folder, depth }) => [folder.path, depth]), [
    ["docs", 1],
    ["src", 1],
    ["src/a", 2],
    ["src/z", 2],
  ]);
});

test("derives folder depth and root-segment styling from map paths", () => {
  assert.equal(folderDepth(""), 0);
  assert.equal(folderDepth("src"), 1);
  assert.equal(folderDepth("src/components/button.js"), 3);

  assert.equal(folderStyle("src", 1).label, folderStyle("src/components", 2).label);
  assert.equal(colorChannels(organicRegionStyle("docs", 1).fill), colorChannels(organicRegionStyle("docs/guides", 2).fill));
  assert.notDeepEqual(folderStyle("src", 1), folderStyle("docs", 1));
});

test("formats folder display names from public map paths", () => {
  assert.equal(folderDisplayName({ path: "" }), "Codebase");
  assert.equal(folderDisplayName({ path: "src" }), "src");
  assert.equal(folderDisplayName({ path: "src/components" }), "components");
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

test("derives Age of Empires style fog state from activity without touching map geography", () => {
  const now = Date.parse("2026-05-20T12:00:00.000Z");
  const codemap = {
    folders: {
      "": { path: "" },
      src: { path: "src" },
      docs: { path: "docs" },
    },
    files: {
      "src/app.ts": codeFile({ path: "src/app.ts", name: "app.ts" }),
      "docs/guide.md": codeFile({ path: "docs/guide.md", name: "guide.md" }),
      "src/other.ts": codeFile({ path: "src/other.ts", name: "other.ts" }),
    },
  };

  const fog = buildActivityFogState(codemap, [
    activity("codex", "reading", "2026-05-20T11:55:00.000Z", {
      address: {
        path: "src/app.ts",
        bounds: { x: 0, y: 0, width: 0.1, height: 0.1 },
        deepLink: "codecharter://file/s000000?path=src%2Fapp.ts",
      },
    }),
    activity("codex", "editing", "2026-05-20T03:00:00.000Z", {
      address: {
        bounds: { x: 0, y: 0, width: 0.1, height: 0.1 },
        deepLink: "codecharter://file/s000000?path=docs%2Fguide.md",
      },
    }),
  ], { now });

  assert.equal(fogStateForFile(fog, "src/app.ts"), "visible");
  assert.equal(fogStateForFile(fog, "docs/guide.md"), "explored");
  assert.equal(fogStateForFile(fog, "src/other.ts"), "unexplored");
  assert.equal(fogStateForFile(fog, "src/other.ts", { selected: true }), "visible");
  assert.equal(fogStateForFolder(fog, "src"), "visible");
  assert.equal(fogStateForFolder(fog, "docs"), "explored");
  assert.equal(fogStateForFolder(fog, ""), "visible");
});

test("applies fog rules to labels and source text disclosure", () => {
  const file = codeFile({ path: "src/app.ts", name: "app.ts", lineCount: 20 });
  const readableBox = { width: 320, height: 320 };

  assert.equal(shouldShowFogLabel("unexplored"), false);
  assert.equal(shouldShowFogSourceText("unexplored"), false);
  assert.equal(shouldLabelFoggedFile({
    file,
    box: readableBox,
    scale: 12,
    selected: false,
    fogState: "unexplored",
  }), false);

  assert.equal(shouldShowFogLabel("explored"), true);
  assert.equal(shouldShowFogSourceText("explored"), true);
  assert.equal(shouldLabelFoggedFile({
    file,
    box: readableBox,
    scale: 12,
    selected: false,
    fogState: "explored",
  }), true);

  assert.equal(shouldShowFogSourceText("visible"), true);
  assert.equal(shouldShowFogSourceText("unexplored", { selected: true }), true);
});

test("defines a layered discovery fog visual contract", () => {
  const veil = discoveryFogVeilStyle();
  assert.equal(veil.textureStep, 28);
  assert.ok(veil.baseAlpha > veil.horizonAlpha);
  assert.ok(veil.textureAlpha > 0 && veil.textureAlpha < 0.12);

  const hidden = discoveryFogRevealStyle();
  const visible = discoveryFogRevealStyle({ visibleFile: true });
  const readable = discoveryFogRevealStyle({ visibleFile: true, readable: true });

  assert.ok(visible.alpha > hidden.alpha);
  assert.ok(readable.alpha > visible.alpha);
  assert.ok(readable.core > visible.core);
  assert.ok(readable.padding > hidden.padding);
  assert.ok(readable.mid >= visible.mid);
  assert.equal(readable.lobes, 1);
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

test("max zoom can make long implementation files readable on the canvas", () => {
  const implementationFile = codeFile({
    path: "public/app.js",
    name: "app.js",
    lineCount: 2070,
  });
  const bounds = { width: 0.12089104181, height: 0.215609560901 };
  const viewport = { width: 960, height: 720 };
  const boxAtMaxZoom = {
    width: bounds.width * viewport.width * MAP_MAX_SCALE,
    height: bounds.height * viewport.height * MAP_MAX_SCALE,
  };

  assert.equal(canRenderSourceText(implementationFile, boxAtMaxZoom), true);
});

test("anchors source text to the visible viewport slice of wide file tiles", () => {
  assert.deepEqual(
    sourceTextLayoutForBox({ x: 24, width: 420 }, 800),
    { lineNumberX: 30, textX: 66, maxChars: 51 },
  );

  assert.deepEqual(
    sourceTextLayoutForBox({ x: -16000, width: 32000 }, 1280),
    { lineNumberX: 6, textX: 42, maxChars: 171 },
  );
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

test("pans camera from a pointer drag without using the live view as the anchor", () => {
  const viewport = { width: 900, height: 600 };
  const drag = {
    start: { x: 120, y: 160 },
    view: { x: 0.1, y: 0.2, scale: 3 },
  };
  const view = panViewForDrag(drag, { x: 210, y: 100 }, viewport);

  assert.deepEqual(roundPoint(view), { x: 0.066666666667, y: 0.233333333333, scale: 3 });
});

test("decodes keyboard actions without coupling to browser effects", () => {
  assert.deepEqual(canvasKeyboardAction({ key: "ArrowRight" }), {
    type: "pan",
    delta: { x: 72, y: 0 },
  });
  assert.deepEqual(canvasKeyboardAction({ key: "=" }), { type: "zoomIn" });
  assert.deepEqual(canvasKeyboardAction({ key: "0" }), { type: "fitCodebase" });
  assert.deepEqual(canvasKeyboardAction({ key: "Enter" }), { type: "selectCenter" });
  assert.equal(canvasKeyboardAction({ key: "a" }), null);

  assert.deepEqual(documentKeyboardAction({
    code: "Space",
    key: " ",
    repeat: false,
  }, {
    textEntry: false,
    buttonTarget: false,
  }), { type: "startSpacePan" });
  assert.deepEqual(documentKeyboardAction({
    key: "Enter",
    metaKey: true,
  }, {
    hasResolvedSelection: true,
  }), { type: "saveSelection" });
  assert.deepEqual(documentKeyboardAction({
    key: "c",
    ctrlKey: true,
  }, {
    textEntry: false,
    hasSelectedAnnotation: true,
  }), { type: "copyAnnotationPrompt" });
});

test("derives double-click map navigation actions without binding to browser effects", () => {
  assert.equal(doubleClickMapAction(null), null);
  assert.equal(doubleClickMapAction({ targetType: "file", path: "src/app.ts" }).type, "selectFile");
  assert.equal(doubleClickMapAction({ targetType: "folder", path: "src" }).type, "selectFolder");
  assert.equal(doubleClickMapAction({ targetType: "annotation", id: "a1" }).type, "focusAnnotation");
  assert.deepEqual(doubleClickMapAction({ targetType: "activity", id: "event-1" }), { type: "selectActivity" });
});

test("derives map target selection actions without binding to source panel effects", () => {
  assert.deepEqual(mapTargetSelectionAction(null), { type: "clearSelection" });
  assert.deepEqual(mapTargetSelectionAction({ targetType: "annotation", id: "a1" }), { type: "focusAnnotation" });
  assert.deepEqual(mapTargetSelectionAction({ targetType: "activity", id: "event-1" }), { type: "selectActivity" });
  assert.deepEqual(mapTargetSelectionAction({ targetType: "folder", path: "src" }), { type: "inspectFolder" });
  assert.deepEqual(mapTargetSelectionAction({ targetType: "file", path: "src/app.ts" }), { type: "inspectFile" });
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

test("derives interaction mode UI state from controller flags", () => {
  assert.deepEqual(interactionModeUiState({
    drawing: false,
    panning: false,
    spacePanning: false,
    dragging: null,
  }), {
    selectActive: true,
    panActive: false,
    drawActive: false,
    panningMode: false,
    drawingMode: false,
    spacePanningMode: false,
    panning: false,
  });

  assert.deepEqual(interactionModeUiState({
    drawing: true,
    panning: false,
    spacePanning: true,
    dragging: { type: "pan" },
  }), {
    selectActive: false,
    panActive: true,
    drawActive: true,
    panningMode: false,
    drawingMode: false,
    spacePanningMode: true,
    panning: true,
  });
});

test("derives draft selection geometry and screen-pixel usability", () => {
  const selection = draftSelectionFromDrag({ x: 0.2, y: 0.3 }, { x: 0.24, y: 0.38 });

  assert.equal(selection.type, "rect");
  assert.deepEqual(roundPoint(selection.bounds), { x: 0.2, y: 0.3, width: 0.04, height: 0.08 });
  assert.equal(isUsableDraftSelection(selection, {
    viewport: { width: 200, height: 100 },
    scale: 1,
    minPixels: 4,
  }), true);
  assert.equal(isUsableDraftSelection(selection, {
    viewport: { width: 80, height: 40 },
    scale: 1,
    minPixels: 4,
  }), false);
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

test("derives source panel state for code context and activity fallbacks", () => {
  assert.deepEqual(sourcePanelState({
    path: "src/app.ts",
    deepLink: "codecharter://lineRange/s000?path=src%2Fapp.ts&lines=7-12",
    source: {
      lines: [
        { number: 7, text: "const app = true;" },
        { number: 12, text: "export default app;" },
      ],
    },
  }), {
    sourceTitle: "src/app.ts · codecharter://lineRange/s000?path=src%2Fapp.ts&lines=7-12",
    sourceOutput: "   7  const app = true;\n  12  export default app;",
    scrollTop: 0,
  });

  assert.deepEqual(sourcePanelState({
    deepLink: "codecharter://activity/s000",
    fallbackOutput: "Activity selected.",
  }), {
    sourceTitle: "codecharter://activity/s000",
    sourceOutput: "Activity selected.",
  });
});

test("caches source ranges as an LRU proxy for source reads", () => {
  const cache = new Map();
  const appSource = {
    path: "src/app.ts",
    lineRange: { start: 1, end: 10 },
    lines: [{ number: 1, text: "one" }],
  };
  const otherSource = {
    path: "src/other.ts",
    lineRange: { start: 1, end: 5 },
    lines: [{ number: 1, text: "other" }],
  };

  rememberSourceRange(cache, sourceRangeCacheKey("src/app.ts", 1, 10), appSource, 2);
  rememberSourceRange(cache, sourceRangeCacheKey("src/other.ts", 1, 5), otherSource, 2);

  assert.equal(cachedSourceRange(cache, "./src/app.ts", 3, 4), appSource);
  assert.deepEqual([...cache.keys()], [
    sourceRangeCacheKey("src/other.ts", 1, 5),
    sourceRangeCacheKey("src/app.ts", 1, 10),
  ]);

  rememberSourceRange(cache, sourceRangeCacheKey("src/third.ts", 1, 2), {
    path: "src/third.ts",
    lineRange: { start: 1, end: 2 },
    lines: [],
  }, 2);

  assert.equal(cachedSourceRange(cache, "src/other.ts", 1, 1), null);
});

test("formats annotation clipboard text with deep links and browser URLs", () => {
  const text = annotationClipboardText({
    id: "annotation-1",
    deepLink: "codecharter://annotation/annotation-1",
    browserHash: "#/annotation/annotation-1",
    comment: "Check this region",
    resolvedTargets: [{ path: "src/app.ts" }, { path: "src/server.ts" }],
  }, {
    origin: "http://127.0.0.1:3000",
    href: "http://127.0.0.1:3000/#/map/file/s000000?path=src%2Fapp.ts",
  });

  assert.match(text, /CodeCharter annotation: codecharter:\/\/annotation\/annotation-1/);
  assert.match(text, /Note: Check this region/);
  assert.match(text, /Resolve: npx --yes codecharter@latest --json resolve "codecharter:\/\/annotation\/annotation-1" --server "http:\/\/127\.0\.0\.1:3000"/);
  assert.match(text, /CodeCharter URL: http:\/\/127\.0\.0\.1:3000\/#\/annotation\/annotation-1/);
  assert.doesNotMatch(text, /Targets:/);
  assert.doesNotMatch(text, /CLI: codecharter/);
  assert.doesNotMatch(text, /Fallback:/);
  assert.doesNotMatch(text, /Use resolve output/);
  assert.doesNotMatch(text, /src\/app\.ts/);
});

test("normalizes ordinary paths to sidecar map keys", () => {
  assert.equal(normalizeMapPath("."), "");
  assert.equal(normalizeMapPath("./src/"), "src");
  assert.equal(normalizeMapPath("src\\app.ts"), "src/app.ts");
});

test("resolves browser map route targets through path metadata or geohash prefix", () => {
  const codemap = {
    files: {
      "src/app.ts": codeFile({
        path: "src/app.ts",
        name: "app.ts",
        bounds: { x: 0.2, y: 0.2, width: 0.2, height: 0.2 },
        geo: { geohash: "s00000000000", lat: 0, lon: 0 },
      }),
    },
    folders: {
      src: {
        path: "src",
        name: "src",
        bounds: { x: 0.1, y: 0.1, width: 0.4, height: 0.4 },
        geo: { geohash: "s0000000zzzz", lat: 0, lon: 0 },
      },
    },
  };

  const byPath = mapRouteTarget(codemap, {
    kind: "file",
    locator: "ignored",
    params: new URLSearchParams("path=.%2Fsrc%2Fapp.ts"),
  });
  const byPrefix = mapRouteTarget(codemap, {
    kind: "folder",
    locator: "s000000",
    params: new URLSearchParams(),
  });
  const byContainingPrefix = mapRouteTarget(codemap, {
    kind: "folder",
    locator: "s0000000zzzz9",
    params: new URLSearchParams(),
  });

  assert.equal(byPath.targetType, "file");
  assert.equal(byPath.path, "src/app.ts");
  assert.equal(byPrefix.targetType, "folder");
  assert.equal(byPrefix.path, "src");
  assert.equal(byContainingPrefix.targetType, "folder");
  assert.equal(byContainingPrefix.path, "src");
});

test("derives browser hash route focus intents without binding to controller effects", () => {
  const params = new URLSearchParams("path=src%2Fapp.ts");
  assert.deepEqual(hashRouteFocusIntent({
    type: "annotation",
    id: "annotation-1",
    params,
  }), { type: "annotation", id: "annotation-1" });

  assert.deepEqual(hashRouteFocusIntent({
    type: "selection",
    params,
  }), { type: "selection", params });

  const mapRoute = {
    type: "map",
    kind: "file",
    locator: "s000000",
    params,
  };
  assert.deepEqual(hashRouteFocusIntent(mapRoute), { type: "map", route: mapRoute });
  assert.equal(hashRouteFocusIntent(mapRoute, { hasMap: false }), null);
  assert.equal(hashRouteFocusIntent({ type: "unknown" }), null);
});

test("derives map route focus actions without binding to source panel effects", () => {
  assert.equal(mapRouteFocusAction(null), null);
  assert.deepEqual(mapRouteFocusAction({ targetType: "file", path: "src/app.ts" }), {
    type: "focusFile",
    zoomPadding: 1.35,
  });
  assert.deepEqual(mapRouteFocusAction({ targetType: "folder", path: "src" }), {
    type: "focusFolder",
    zoomPadding: 1.6,
  });
});

test("resolves map search matches by navigation priority", () => {
  const codemap = {
    files: {
      "src/app.ts": codeFile({
        path: "src/app.ts",
        name: "app.ts",
        geo: { geohash: "s00000000000", lat: 0, lon: 0 },
      }),
    },
    folders: {
      "src/features": {
        path: "src/features",
        name: "features",
        bounds: { x: 0.1, y: 0.1, width: 0.4, height: 0.4 },
        geo: { geohash: "u12345000000", lat: 0, lon: 0 },
      },
    },
  };
  const namedPlaces = [{
    id: "annotation-1",
    kind: "mapAnnotation",
    name: "App note",
    geometry: { bounds: { x: 0.3, y: 0.3, width: 0.1, height: 0.1 } },
  }];

  const annotation = mapSearchMatch(codemap, namedPlaces, "app");
  const folder = mapSearchMatch(codemap, namedPlaces, "u12345");

  assert.ok(annotation);
  assert.equal(annotation.type, "annotation");
  assert.equal(annotation.label, "Annotation: App note");
  if (!("target" in annotation)) assert.fail("Expected annotation search target");
  assert.equal(annotation.target.targetType, "annotation");
  assert.ok(folder);
  assert.equal(folder.type, "folder");
  assert.equal(folder.label, "Folder: src/features");
});

test("keeps map search priority and first matching target order", () => {
  const codemap = {
    files: {
      "src/app.ts": {
        path: "src/app.ts",
        bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        geo: { geohash: "u10000000000", lat: 0, lon: 0 },
      },
      "src/app-helper.ts": {
        path: "src/app-helper.ts",
        bounds: { x: 0.2, y: 0.1, width: 0.2, height: 0.2 },
        geo: { geohash: "u10001000000", lat: 0, lon: 0 },
      },
    },
    folders: {
      "src/app": {
        path: "src/app",
        bounds: { x: 0.1, y: 0.1, width: 0.4, height: 0.4 },
        geo: { geohash: "u10000000000", lat: 0, lon: 0 },
      },
    },
  };
  const namedPlaces = [{
    id: "place-without-bounds",
    kind: "drawnSelection",
    name: "app",
    geometry: {},
  }];

  const match = mapSearchMatch(codemap, namedPlaces, "app");

  assert.ok(match);
  assert.equal(match.type, "file");
  if (!("file" in match)) assert.fail("Expected file search match");
  assert.equal(match.file.path, "src/app.ts");
});

test("map search reflects target and place updates after earlier searches", () => {
  const codemap = {
    files: {
      "src/app.ts": {
        path: "src/app.ts",
        bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        geo: { geohash: "u10000000000", lat: 0, lon: 0 },
      },
    },
    folders: {},
  };
  const namedPlaces = [{
    id: "place-1",
    kind: "drawnSelection",
    name: "Original area",
    geometry: { bounds: { x: 0.3, y: 0.3, width: 0.1, height: 0.1 } },
  }];

  assert.equal(mapSearchMatch(codemap, namedPlaces, "app").type, "file");

  codemap.files["src/app.ts"].path = "src/renamed.ts";
  codemap.files["src/late-added.ts"] = {
    path: "src/late-added.ts",
    bounds: { x: 0.2, y: 0.1, width: 0.2, height: 0.2 },
    geo: { geohash: "u10001000000", lat: 0, lon: 0 },
  };
  namedPlaces[0].name = "Updated area";

  assert.equal(mapSearchMatch(codemap, namedPlaces, "app"), null);
  const fileMatch = mapSearchMatch(codemap, namedPlaces, "late-added");
  const placeMatch = mapSearchMatch(codemap, namedPlaces, "updated");
  assert.ok(fileMatch);
  assert.ok(placeMatch);
  if (!("file" in fileMatch)) assert.fail("Expected file search match");
  if (!("place" in placeMatch)) assert.fail("Expected place search match");
  assert.equal(fileMatch.file.path, "src/late-added.ts");
  assert.equal(placeMatch.place.id, "place-1");
});

test("derives map search actions without binding to browser effects", () => {
  assert.deepEqual(mapSearchAction(null), { type: "noMatch" });
  assert.deepEqual(mapSearchAction({ type: "annotation", label: "Annotation: App note" }), { type: "focusPlace" });
  assert.deepEqual(mapSearchAction({ type: "namedPlace", label: "Named place: Area" }), { type: "focusPlace" });
  assert.deepEqual(mapSearchAction({ type: "file", label: "File: src/app.ts" }), { type: "focusFile" });
  assert.deepEqual(mapSearchAction({ type: "folder", label: "Folder: src" }), { type: "focusFolder" });
});

test("derives map selection panel copy for empty, folder, and file targets", () => {
  assert.deepEqual(mapSelectionPanel(null), {
    inspectorTitle: "No place selected",
    inspectorSubtitle: "Click a district, parcel, or activity marker.",
    sourceTitle: "No file selected",
    sourceOutput: "",
  });

  assert.deepEqual(mapSelectionPanel({
    targetType: "folder",
    path: "",
    geo: { geohash: "s000000" },
  }), {
    inspectorTitle: "Codebase",
    inspectorSubtitle: "folder: . | s000000",
    sourceTitle: ".",
    sourceOutput: "Folder selected.",
  });

  assert.deepEqual(mapSelectionPanel({
    targetType: "file",
    path: "src/app.ts",
    name: "app.ts",
    geo: { geohash: "s000001" },
  }), {
    inspectorTitle: "app.ts",
    inspectorSubtitle: "file: src/app.ts | s000001",
  });
});

test("reconciles selected map targets against refreshed sidecar state", () => {
  const codemap = {
    folders: {
      src: {
        path: "src",
        name: "src",
        bounds: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
        geo: { geohash: "u12345000000", lat: 0, lon: 0 },
      },
    },
    files: {
      "src/app.ts": codeFile({
        path: "src/app.ts",
        bounds: { x: 0.2, y: 0.2, width: 0.2, height: 0.2 },
        geo: { geohash: "s99999000000", lat: 0, lon: 0 },
      }),
    },
  };

  const file = reconciledSelectedTarget(codemap, { targetType: "file", path: "src/app.ts", geo: { geohash: "old" } });
  const folder = reconciledSelectedTarget(codemap, { targetType: "folder", path: "src", geo: { geohash: "old" } });
  const activity = { targetType: "activity", id: "event-1" };

  assert.equal(file.geo.geohash, "s99999000000");
  assert.equal(folder.geo.geohash, "u12345000000");
  assert.equal(reconciledSelectedTarget(codemap, { targetType: "file", path: "src/missing.ts" }), null);
  assert.equal(reconciledSelectedTarget(codemap, activity), activity);
  assert.equal(reconciledSelectedTarget(codemap, null), null);
});

test("formats map hover labels without binding to browser state", () => {
  assert.equal(mapHoverLabel({
    targetType: "annotation",
    name: "Review area",
    coveringSet: ["s123"],
  }), "annotation: Review area | s123");

  assert.equal(mapHoverLabel({
    targetType: "activity",
    agentId: "codex",
    threadId: "019e4c43-dd59",
    activityState: "blocked",
    address: { geohash: "u987" },
  }), "activity: codex 019e4c43 reviewing | u987");

  assert.equal(mapHoverLabel({
    targetType: "file",
    path: "src/app.ts",
    geo: { geohash: "s999" },
  }), "file: src/app.ts | s999");
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

test("hit-testing breaks equal-area target ties by path", () => {
  const codemap = {
    folders: {},
    files: {
      "src/b.js": target("src/b.js", "file", { x: 0.2, y: 0.2, width: 0.4, height: 0.4 }),
      "src/a.js": target("src/a.js", "file", { x: 0.2, y: 0.2, width: 0.4, height: 0.4 }),
    },
  };

  const hit = hitTestTargets(codemap, { x: 0.35, y: 0.35 });

  assert.equal(hit.targetType, "file");
  assert.equal(hit.path, "src/a.js");
});

test("hit-testing annotations prefers the newest visible annotation without allocating reversed candidates", () => {
  const annotations = [
    {
      id: "older",
      name: "Older",
      kind: "mapAnnotation",
      geometry: { bounds: { x: 0.2, y: 0.2, width: 0.2, height: 0.2 } },
    },
    {
      id: "selection",
      name: "Selection",
      kind: "drawnSelection",
      geometry: { bounds: { x: 0.25, y: 0.25, width: 0.2, height: 0.2 } },
    },
    {
      id: "newer",
      name: "Newer",
      kind: "mapAnnotation",
      geometry: { bounds: { x: 0.21, y: 0.21, width: 0.2, height: 0.2 } },
    },
  ];

  const hit = hitTestAnnotations(annotations, { x: 0.3, y: 0.3 });

  assert.equal(hit.targetType, "annotation");
  assert.equal(hit.id, "newer");
});

test("hit-testing activity prefers the newest live event near a fragment center", () => {
  const now = Date.parse("2026-05-20T12:00:00.000Z");
  const older = activity("codex", "reading", "2026-05-20T10:00:00.000Z", {
    id: "older",
    address: {
      bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
      fragments: [{ bounds: { x: 0.2, y: 0.2, width: 0.04, height: 0.04 } }],
    },
  });
  const newer = activity("codex", "editing", "2026-05-20T10:03:00.000Z", {
    id: "newer",
    address: {
      bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
      fragments: [{ bounds: { x: 0.205, y: 0.205, width: 0.04, height: 0.04 } }],
    },
  });

  const hit = hitTestActivityEventsForTest([newer, older], { x: 0.222, y: 0.222 }, {
    radiusX: 0.03,
    radiusY: 0.03,
    now,
  });

  assert.equal(hit.targetType, "activity");
  assert.equal(hit.id, "newer");
});

test("hit-testing activity ignores expired newer events while choosing the newest matching live event", () => {
  const now = Date.parse("2026-05-20T12:00:00.000Z");
  const oldLive = activity("codex", "reading", "2026-05-20T10:00:00.000Z", {
    id: "old-live",
    address: { bounds: { x: 0.2, y: 0.2, width: 0.04, height: 0.04 } },
  });
  const newestLiveMiss = activity("codex", "testing", "2026-05-20T10:04:00.000Z", {
    id: "newest-live-miss",
    address: { bounds: { x: 0.8, y: 0.8, width: 0.04, height: 0.04 } },
  });
  const newerLiveHit = activity("codex", "editing", "2026-05-20T10:03:00.000Z", {
    id: "newer-live-hit",
    address: { bounds: { x: 0.205, y: 0.205, width: 0.04, height: 0.04 } },
  });
  const expiredHit = activity("codex", "reviewing", "2026-05-19T10:05:00.000Z", {
    id: "expired-hit",
    address: { bounds: { x: 0.21, y: 0.21, width: 0.04, height: 0.04 } },
  });

  const hit = hitTestActivityEventsForTest([newestLiveMiss, oldLive, expiredHit, newerLiveHit], { x: 0.222, y: 0.222 }, {
    radiusX: 0.03,
    radiusY: 0.03,
    now,
    maxAgeMinutes: 180,
  });

  assert.equal(hit.id, "newer-live-hit");
});

test("hit-testing activity uses fragment centers instead of aggregate centers", () => {
  const now = Date.parse("2026-05-20T12:00:00.000Z");
  const event = activity("codex", "editing", "2026-05-20T11:59:00.000Z", {
    address: {
      bounds: { x: 0.2, y: 0.2, width: 0.2, height: 0.2 },
      fragments: [{ bounds: { x: 0.7, y: 0.7, width: 0.04, height: 0.04 } }],
    },
  });

  assert.equal(hitTestActivityEventsForTest([event], { x: 0.3, y: 0.3 }, {
    radiusX: 0.02,
    radiusY: 0.02,
    now,
  }), null);

  const hit = hitTestActivityEventsForTest([event], { x: 0.72, y: 0.72 }, {
    radiusX: 0.02,
    radiusY: 0.02,
    now,
  });

  assert.equal(hit.id, event.id);
});

test("derives organic region contours deterministically from world bounds", () => {
  const bounds = { x: 0.12, y: 0.2, width: 0.32, height: 0.18 };
  const first = organicRegionPoints(bounds, "src/features", 2);
  const second = organicRegionPoints(bounds, "src/features", 2);
  const other = organicRegionPoints(bounds, "src/search", 2);

  assert.deepEqual(roundPoints(first), [
    [0.1456, 0.205156940138],
    [0.1968, 0.205156940139],
    [0.2544, 0.205156940139],
    [0.312, 0.20515694014],
    [0.3696, 0.205156940141],
    [0.4144, 0.205156940141],
    [0.43169209312, 0.2144],
    [0.431692093119, 0.2432],
    [0.431692093117, 0.2756],
    [0.431692093116, 0.308],
    [0.431692093115, 0.3404],
    [0.431692093114, 0.3656],
    [0.4144, 0.373062728318],
    [0.3696, 0.373062728319],
    [0.312, 0.373062728319],
    [0.2544, 0.37306272832],
    [0.1968, 0.373062728321],
    [0.1456, 0.373062728321],
    [0.128115915391, 0.3656],
    [0.12811591539, 0.3404],
    [0.128115915389, 0.308],
    [0.128115915388, 0.2756],
    [0.128115915387, 0.2432],
    [0.128115915386, 0.2144],
  ]);
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

  const groups = activityTrailGroups([events[2], events[0], events[3], events[1]], {
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

test("keeps bounded sorted activity events chronological when input arrives out of order", () => {
  const now = Date.parse("2026-05-20T12:00:00.000Z");
  const events = [
    activity("agent-3", "reading", "2026-05-20T10:03:00.000Z"),
    activity("agent-1", "reading", "2026-05-20T10:01:00.000Z"),
    activity("agent-4", "reading", "2026-05-20T10:04:00.000Z"),
    activity("agent-2", "reading", "2026-05-20T10:02:00.000Z"),
  ];

  assert.deepEqual(sortedActivityEvents(events, 3, { now }).map((event) => event.agentId), ["agent-2", "agent-3", "agent-4"]);
});

test("preserves existing non-positive activity event limit semantics", () => {
  const now = Date.parse("2026-05-20T12:00:00.000Z");
  const events = [
    activity("agent-1", "reading", "2026-05-20T10:01:00.000Z"),
    activity("agent-2", "reading", "2026-05-20T10:02:00.000Z"),
    activity("agent-3", "reading", "2026-05-20T10:03:00.000Z"),
  ];

  assert.deepEqual(sortedActivityEvents(events, 0, { now }).map((event) => event.agentId), ["agent-1", "agent-2", "agent-3"]);
  assert.deepEqual(sortedActivityEvents(events, -1, { now }).map((event) => event.agentId), ["agent-2", "agent-3"]);
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

test("keeps latest activity map ordered by each agent's first live event", () => {
  const now = Date.parse("2026-05-20T12:00:00.000Z");
  const events = [
    activity("codex", "reviewing", "2026-05-20T10:04:00.000Z", { threadId: "thread-a" }),
    activity("reviewer", "testing", "2026-05-20T10:01:00.000Z"),
    activity("codex", "editing", "2026-05-20T10:06:00.000Z", { threadId: "thread-a" }),
    activity("codex", "reading", "2026-05-20T10:03:00.000Z", { threadId: "thread-b" }),
  ];

  const latest = latestActivityByAgent(events, { now });

  assert.deepEqual([...latest.keys()], ["reviewer:manual", "codex:thread-b", "codex:thread-a"]);
  assert.equal(latest.get("codex:thread-a").activityState, "editing");
});

test("selects the activity feed as the five newest latest-agent events with stable ties", () => {
  const now = Date.parse("2026-05-20T12:00:00.000Z");
  const events = [
    activity("agent-1", "reading", "2026-05-20T10:00:00.000Z"),
    activity("agent-2", "reading", "2026-05-20T10:06:00.000Z"),
    activity("agent-3", "editing", "2026-05-20T10:06:00.000Z"),
    activity("agent-4", "testing", "2026-05-20T10:04:00.000Z"),
    activity("agent-5", "reviewing", "2026-05-20T10:03:00.000Z"),
    activity("agent-6", "editing", "2026-05-20T10:02:00.000Z"),
    activity("agent-1", "testing", "2026-05-20T10:05:00.000Z"),
  ];

  assert.deepEqual(activityFeedEvents(events, { now }).map((event) => event.agentId), [
    "agent-2",
    "agent-3",
    "agent-1",
    "agent-4",
    "agent-5",
  ]);
});

test("keeps activity feed fallback order stable for invalid live timestamps", () => {
  const now = Date.parse("2026-05-20T12:00:00.000Z");
  const events = [
    activity("invalid", "reading", "not-a-date"),
    activity("newer", "editing", "2026-05-20T10:06:00.000Z"),
    activity("older", "testing", "2026-05-20T10:05:00.000Z"),
  ];

  assert.deepEqual(activityFeedEvents(events, { now }).map((event) => event.agentId), ["invalid", "newer", "older"]);
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

type TestBounds = { x: number; y: number; width: number; height: number };
type TestCodeFile = {
  path: string;
  name: string;
  lineCount: number;
  bounds?: TestBounds;
  [key: string]: unknown;
};
type TestActivity = {
  id: string;
  agentId: string;
  activityState: string;
  timestamp: string;
  address: {
    bounds: TestBounds;
    geohash?: string;
    deepLink?: string;
    fragments?: Array<{ bounds: TestBounds }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

function codeFile(overrides: Partial<TestCodeFile> = {}): TestCodeFile {
  return {
    path: "src/app.js",
    name: "app.js",
    lineCount: 24,
    ...overrides,
  };
}

function activity(agentId: string, activityState: string, timestamp: string, overrides: Partial<TestActivity> = {}): TestActivity {
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

function roundPoint(point: Record<string, number>) {
  return Object.fromEntries(
    Object.entries(point).map(([key, value]) => [key, Number(value.toFixed(12))]),
  );
}

function colorChannels(rgba) {
  return rgba.slice(0, rgba.lastIndexOf(","));
}

function ratio(point, bounds) {
  return {
    x: Number(((point.x - bounds.x) / bounds.width).toFixed(12)),
    y: Number(((point.y - bounds.y) / bounds.height).toFixed(12)),
  };
}

function roundPoints(points) {
  return points.map((point) => [
    Number(point.x.toFixed(12)),
    Number(point.y.toFixed(12)),
  ]);
}
