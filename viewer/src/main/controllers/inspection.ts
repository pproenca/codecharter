/**
 * Target inspection + source-panel controller: selecting and inspecting a map
 * target (folder/file/activity) and driving the inspector + source panel. The
 * semantic state (the selected target, the map) stays in app state — the render
 * loop and `updateSelectionPopover` read it — so this controller operates
 * through injected getters/setters and app-owned UI callbacks. It owns no second
 * identity model. Pure selection-panel, source-context, line-range, and activity
 * label helpers are imported directly from `render/*`; the cross-tool Deep Link
 * route is built with `createMapHashRoute` and written back through the injected
 * `syncHashRoute` (the routing controller's stable-route writer).
 */

import { createMapHashRoute } from "../deep-links.ts";
import {
  activityActorLabel,
  activityPathLabel,
  canRenderSourceText,
  lineAtWorldPoint,
  mapSelectionPanel,
  normalizeActivityState,
  pathFromDeepLink,
  screenBoundsForView,
  sourceContextRequest,
  sourcePanelLineRangeForBox,
  sourcePanelState,
} from "../render/index.ts";
import type {
  ActivityEvent,
  Bounds,
  CodecharterMap,
  MapActionOf,
  MapAnnotationPlace,
  MapFile,
  MapRouteKind,
  NamedPlace,
  Point,
  SourceRange,
  TargetHit,
  View,
  Viewport,
} from "../render/index.ts";

type AnnotationHit = NamedPlace & { targetType: "annotation" };
type ActivityHit = ActivityEvent & { targetType: "activity" };
type HitTarget = TargetHit | AnnotationHit | ActivityHit;
type TargetSelectionAction = MapActionOf<
  "clearSelection" | "focusAnnotation" | "selectActivity" | "inspectFolder" | "inspectFile"
>;
type ResolvedAddressResponse = { targetType: MapRouteKind; geohash: string; deepLink: string };
type SourcePanel = {
  sourceTitle: string;
  sourceOutput: string;
  scrollTop?: number;
};

type InspectionControls = {
  inspectorTitle: HTMLElement | null;
  inspectorSubtitle: HTMLElement | null;
  sourceTitle: HTMLElement | null;
  sourceOutput: HTMLElement | null;
};

function hasBounds<T extends { bounds?: Bounds }>(
  target: T | null | undefined,
): target is T & { bounds: Bounds } {
  return target?.bounds !== undefined;
}

function hasGeometryBounds<T extends { geometry?: { bounds?: Bounds } }>(
  target: T | null | undefined,
): target is T & { geometry: { bounds: Bounds } } {
  return target?.geometry?.bounds !== undefined;
}

export type InspectionControllerDeps = {
  // State accessors (the shared semantic state stays in app.ts).
  getMap: () => CodecharterMap | null;
  setSelectedTarget: (target: HitTarget | null) => void;

  // Controls (for setText calls).
  controls: InspectionControls;

  // App-owned callbacks (stay in app.ts, injected).
  setText: (element: HTMLElement | null, value: string) => void;
  render: () => void;
  applySourcePanel: (panel: SourcePanel) => void;
  fetchJson: <T = unknown>(url: string) => Promise<T>;
  viewportSize: () => Viewport;
  /** canvas.clientHeight for sourcePanelLineRange. */
  canvasClientHeight: () => number;
  /** Wraps screenBoundsForView(bounds, state.view, viewportSize()). */
  screenBounds: (bounds: Bounds) => Bounds;
  zoomToBounds: (bounds: Bounds, paddingFactor?: number) => void;
  zoomToReadableFile: (file: MapFile, lineRatio?: number) => View;
  lineRatioForLine: (file: MapFile, line: number) => number;
  updateSelectionPopover: () => void;
  /** Wraps routing.syncHashRoute. */
  syncHashRoute: (hash: string) => void;

  // Cross-controller calls (already-constructed controllers, injected).
  editing: {
    clearPendingDelete: () => void;
    clearAnnotationForm: () => void;
    selectAnnotation: (annotation: MapAnnotationPlace) => void;
  };
};

export type InspectionController = ReturnType<typeof createInspectionController>;

export function createInspectionController(deps: InspectionControllerDeps) {
  async function handleMapTargetSelectionAction(
    action: TargetSelectionAction,
    hit: HitTarget | null,
    worldPoint: Point,
  ) {
    switch (action.type) {
      case "clearSelection":
        clearMapSelection();
        return;
      case "focusAnnotation":
        if (hit?.targetType !== "annotation" || !hasGeometryBounds(hit)) {
          return;
        }
        deps.zoomToBounds(hit.geometry.bounds, 1.35);
        deps.editing.selectAnnotation(hit);
        return;
      case "selectActivity":
        if (hit?.targetType === "activity") {
          await selectActivityEvent(hit);
        }
        return;
      case "inspectFolder":
        if (hit?.targetType === "folder") {
          inspectFolderTarget(hit);
        }
        return;
      case "inspectFile":
        if (hit?.targetType === "file") {
          await inspectFileTarget(hit, worldPoint);
        }
    }
  }

  function clearMapSelection() {
    deps.editing.clearPendingDelete();
    const panel = mapSelectionPanel(null);
    deps.setSelectedTarget(null);
    deps.setText(deps.controls.inspectorTitle, panel.inspectorTitle ?? "");
    deps.setText(deps.controls.inspectorSubtitle, panel.inspectorSubtitle);
    deps.setText(deps.controls.sourceTitle, panel.sourceTitle ?? "");
    deps.setText(deps.controls.sourceOutput, panel.sourceOutput ?? "");
    deps.updateSelectionPopover();
    deps.render();
  }

  function inspectMapTarget(hit: TargetHit) {
    deps.editing.clearPendingDelete();
    deps.editing.clearAnnotationForm();
    deps.setSelectedTarget(hit);

    const panel = mapSelectionPanel(hit);
    deps.setText(deps.controls.inspectorTitle, panel.inspectorTitle ?? "");
    deps.setText(deps.controls.inspectorSubtitle, panel.inspectorSubtitle ?? "");
    deps.syncHashRoute(
      createMapHashRoute(hit.targetType, hit.geo?.geohash ?? "", { path: hit.path }),
    );
    return panel;
  }

  function inspectFolderTarget(hit: TargetHit) {
    const panel = inspectMapTarget(hit);
    deps.setText(deps.controls.sourceTitle, panel.sourceTitle ?? "");
    deps.setText(deps.controls.sourceOutput, panel.sourceOutput ?? "");
    deps.render();
  }

  async function inspectFileTarget(
    hit: MapFile & { targetType: "file" },
    worldPoint: Point,
    { zoomReadable = false } = {},
  ) {
    if (!hasBounds(hit)) {
      return;
    }
    inspectMapTarget(hit);
    const line = lineAtWorldPoint(hit, worldPoint);
    const lineRatio = deps.lineRatioForLine(hit, line);
    let box = deps.screenBounds(hit.bounds);
    if (zoomReadable && !canRenderSourceText(hit, box)) {
      const readableView = deps.zoomToReadableFile(hit, lineRatio);
      box = screenBoundsForView(hit.bounds, readableView, deps.viewportSize());
    }
    const lineRange = sourcePanelLineRange(hit, line, box);
    const sourceContext = sourceContextRequest(hit.path, lineRange);
    const [address, source] = await fetchSourceContext(sourceContext);
    deps.syncHashRoute(
      createMapHashRoute(address.targetType, address.geohash, {
        path: hit.path,
        lines: sourceContext.lines,
      }),
    );

    deps.applySourcePanel(sourcePanelState({ path: hit.path, deepLink: address.deepLink, source }));
    deps.render();
  }

  async function selectActivityEvent(event: ActivityEvent, { zoomReadable = false } = {}) {
    deps.setSelectedTarget({ ...event, targetType: "activity" });
    deps.editing.clearAnnotationForm();
    deps.setText(
      deps.controls.inspectorTitle,
      `${activityActorLabel(event)}: ${normalizeActivityState(event.activityState)}`,
    );
    deps.setText(
      deps.controls.inspectorSubtitle,
      `activity: ${activityPathLabel(event)} | ${event.address?.geohash ?? "unresolved"}`,
    );

    const path = pathFromActivity(event);
    if (!path) {
      deps.applySourcePanel(
        sourcePanelState({
          fallbackOutput: event.note || "Activity selected.",
          ...(event.address?.deepLink === undefined ? {} : { deepLink: event.address.deepLink }),
        }),
      );
      deps.render();
      return;
    }

    const lineRange = event.address?.lineRange ?? { start: 1 };
    if (zoomReadable) {
      const file = deps.getMap()?.files?.[path];
      if (file) {
        deps.zoomToReadableFile(file, deps.lineRatioForLine(file, lineRange.start));
      }
    }
    const sourceContext = sourceContextRequest(path, lineRange);
    const [address, source] = await fetchSourceContext(sourceContext);
    deps.syncHashRoute(
      createMapHashRoute(address.targetType, address.geohash, { path, lines: sourceContext.lines }),
    );
    deps.applySourcePanel(sourcePanelState({ path, deepLink: address.deepLink, source }));
    deps.render();
  }

  function fetchSourceContext(
    sourceContext: ReturnType<typeof sourceContextRequest>,
  ): Promise<[ResolvedAddressResponse, SourceRange]> {
    return Promise.all([
      deps.fetchJson<ResolvedAddressResponse>(sourceContext.resolveUrl),
      deps.fetchJson<SourceRange>(sourceContext.sourceUrl),
    ]);
  }

  function sourcePanelLineRange(file: MapFile, focusLine: number, box: Bounds) {
    return sourcePanelLineRangeForBox(file, focusLine, box, deps.canvasClientHeight());
  }

  function pathFromActivity(event: ActivityEvent) {
    return pathFromDeepLink(event.address?.deepLink);
  }

  return {
    handleMapTargetSelectionAction,
    clearMapSelection,
    inspectMapTarget,
    inspectFolderTarget,
    inspectFileTarget,
    selectActivityEvent,
    fetchSourceContext,
    sourcePanelLineRange,
  };
}
