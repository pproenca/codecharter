/**
 * Browser hash-route controller: parse the current `#…` route, focus the matching
 * annotation / selection / map target, and write stable routes back without
 * re-triggering an apply. Browser hash routes are viewer-local UI state (the
 * `codecharter://` Deep Link contract lives elsewhere); this controller derives
 * everything it focuses from the shared map/named-places state and the already-
 * constructed editing + selection controllers, so it owns no second identity
 * model. Only the route-sequence token and the in-apply latch are module-private
 * to this factory; pure route parsing/target resolution lives in the unit-tested
 * `deep-links.ts` + `render/*` helpers and is imported directly.
 */

import { boundsFromRouteParams, parseHashRoute } from "../deep-links.ts";
import {
  folderDisplayName,
  hashRouteFocusIntent,
  mapRouteFocusAction,
  mapRouteTarget,
  sourceContextRequest,
  sourcePanelState,
} from "../render/index.ts";
import type {
  Bounds,
  CodecharterMap,
  MapActionOf,
  MapAnnotationPlace,
  MapFile,
  MapHashRoute,
  MapRouteKind,
  NamedPlace,
  SourceRange,
  TargetHit,
} from "../render/index.ts";

type RouteToken = number;
type ParsedLineRange = { start: number; end: number };
type MapRouteFocusAction = MapActionOf<"focusFile" | "focusFolder">;
type HashRouteIntent = NonNullable<ReturnType<typeof hashRouteFocusIntent>>;
type AnnotationResponse = { annotation: MapAnnotationPlace };
type ResolvedAddressResponse = { targetType: MapRouteKind; geohash: string; deepLink: string };
type SourcePanel = {
  sourceTitle: string;
  sourceOutput: string;
  scrollTop?: number;
};

type RoutingControls = {
  sourceTitle: HTMLElement | null;
  sourceOutput: HTMLElement | null;
  inspectorTitle: HTMLElement | null;
  inspectorSubtitle: HTMLElement | null;
};

function hasBounds<T extends { bounds?: Bounds }>(
  target: T | null | undefined,
): target is T & { bounds: Bounds } {
  return target?.bounds !== undefined;
}

export type RoutingControllerDeps = {
  // State accessors (the shared semantic state stays in app.ts).
  getMap: () => CodecharterMap | null;
  getNamedPlacesById: () => Map<string, NamedPlace>;
  setDrawing: (value: boolean) => void;
  setSelectedTarget: (target: TargetHit | null) => void;
  setDraftSelection: (draft: { type: "rect"; bounds: Bounds } | null) => void;

  // Controls (for setText calls).
  controls: RoutingControls;

  // App-owned callbacks (stay in app.ts, injected).
  resetSelectionOverlay: () => void;
  updateInteractionModeUi: () => void;
  updateSelectionPopover: () => void;
  setSelectionStatus: (message: string) => void;
  zoomToBounds: (bounds: Bounds, paddingFactor?: number) => void;
  zoomToReadableFile: (file: MapFile, lineRatio: number) => void;
  lineRatioForLine: (file: MapFile, line: number) => number;
  parseLineRange: (value: string | null | undefined) => ParsedLineRange | null;
  applySourcePanel: (panel: SourcePanel) => void;
  fetchSourceContext: (
    sourceContext: ReturnType<typeof sourceContextRequest>,
  ) => Promise<[ResolvedAddressResponse, SourceRange]>;
  fetchJson: <T = unknown>(url: string) => Promise<T>;
  setText: (element: HTMLElement | null, value: string) => void;
  render: () => void;

  // Cross-controller calls (already-constructed controllers, injected).
  editing: {
    upsertNamedPlace: (place: NamedPlace) => void;
    selectAnnotation: (annotation: MapAnnotationPlace) => void;
    clearAnnotationForm: () => void;
  };
  selection: {
    preview: (options?: { routeToken?: number | null }) => Promise<void>;
  };
};

export type RoutingController = ReturnType<typeof createRoutingController>;

export function createRoutingController(deps: RoutingControllerDeps) {
  let applyingRoute = false;
  let routeSequence = 0;

  async function applyHashRoute() {
    const routeToken = ++routeSequence;
    const route = parseHashRoute(window.location.hash);
    const intent = hashRouteFocusIntent(route, { hasMap: deps.getMap() !== null });
    if (!intent) {
      return;
    }

    applyingRoute = true;
    try {
      await focusHashRouteIntent(intent, routeToken);
    } finally {
      if (routeToken === routeSequence) {
        applyingRoute = false;
      }
    }
  }

  async function focusHashRouteIntent(
    intent: HashRouteIntent,
    routeToken: RouteToken,
  ): Promise<void> {
    switch (intent.type) {
      case "annotation":
        await focusAnnotationRoute(intent.id, routeToken);
        return;
      case "selection":
        await focusSelectionRoute(intent.params, routeToken);
        return;
      case "map":
        await focusMapRoute(intent.route, routeToken);
    }
  }

  async function focusAnnotationRoute(id: string, routeToken: RouteToken) {
    let annotation: NamedPlace | null | undefined = deps.getNamedPlacesById().get(id);
    if (annotation?.kind !== "mapAnnotation") {
      annotation = null;
    }
    if (!annotation) {
      try {
        annotation = (
          await deps.fetchJson<AnnotationResponse>(`/api/annotations/${encodeURIComponent(id)}`)
        ).annotation;
      } catch {
        return;
      }
    }
    if (!isCurrentRoute(routeToken)) {
      return;
    }
    if (!annotation.geometry?.bounds) {
      return;
    }
    deps.editing.upsertNamedPlace(annotation);
    deps.resetSelectionOverlay();
    deps.zoomToBounds(annotation.geometry.bounds, 1.35);
    deps.editing.selectAnnotation(annotation);
  }

  async function focusSelectionRoute(params: URLSearchParams, routeToken: RouteToken) {
    const bounds = boundsFromRouteParams(params);
    if (!bounds) {
      return;
    }
    deps.resetSelectionOverlay();
    deps.setDrawing(true);
    deps.updateInteractionModeUi();
    deps.setSelectedTarget(null);
    deps.setText(deps.controls.sourceTitle, "");
    deps.setText(deps.controls.sourceOutput, "");
    deps.setDraftSelection({ type: "rect", bounds });
    deps.updateSelectionPopover();
    deps.setSelectionStatus("Resolving selection...");
    deps.zoomToBounds(bounds, 1.35);
    await deps.selection.preview({ routeToken });
  }

  async function focusMapRoute(route: MapHashRoute, routeToken: RouteToken) {
    const map = deps.getMap();
    if (!map) {
      return;
    }
    const target = mapRouteTarget(map, route);
    const action = mapRouteFocusAction(target);
    if (!target || !action || !hasBounds(target)) {
      return;
    }

    deps.resetSelectionOverlay();
    const routeLineRange =
      target.targetType === "file" ? deps.parseLineRange(route.params.get("lines")) : null;
    if (target.targetType === "file" && routeLineRange) {
      deps.zoomToReadableFile(target, deps.lineRatioForLine(target, routeLineRange.start));
    } else {
      deps.zoomToBounds(target.bounds, action.zoomPadding);
    }
    deps.setSelectedTarget(target);
    await handleMapRouteFocusAction(action, target, route, routeToken);
  }

  async function handleMapRouteFocusAction(
    action: MapRouteFocusAction,
    target: TargetHit,
    route: MapHashRoute,
    routeToken: RouteToken,
  ) {
    switch (action.type) {
      case "focusFile":
        if (target.targetType === "file") {
          await showFileForRoute(target, route.params, routeToken);
        }
        return;
      case "focusFolder":
        if (target.targetType !== "folder") {
          return;
        }
        deps.editing.clearAnnotationForm();
        deps.setText(deps.controls.inspectorTitle, folderDisplayName(target));
        deps.setText(
          deps.controls.inspectorSubtitle,
          `folder: ${target.path || "."} | ${target.geo?.geohash ?? "unresolved"}`,
        );
        deps.render();
    }
  }

  async function showFileForRoute(file: MapFile, params: URLSearchParams, routeToken: RouteToken) {
    deps.editing.clearAnnotationForm();
    deps.setText(deps.controls.inspectorTitle, file.name ?? file.path);
    deps.setText(
      deps.controls.inspectorSubtitle,
      `file: ${file.path} | ${file.geo?.geohash ?? "unresolved"}`,
    );

    const lineRange = deps.parseLineRange(params.get("lines"));
    if (!lineRange) {
      deps.applySourcePanel(sourcePanelState({ path: file.path }));
      deps.render();
      return;
    }

    const sourceContext = sourceContextRequest(file.path, lineRange);
    const [address, source] = await deps.fetchSourceContext(sourceContext);
    if (!isCurrentRoute(routeToken)) {
      return;
    }
    deps.applySourcePanel(
      sourcePanelState({ path: file.path, deepLink: address.deepLink, source }),
    );
    deps.render();
  }

  function syncHashRoute(hash: string) {
    if (applyingRoute || !hash || window.location.hash === hash) {
      return;
    }
    window.history.replaceState(null, "", hash);
  }

  function isCurrentRoute(routeToken: RouteToken) {
    return routeToken === routeSequence;
  }

  return {
    applyHashRoute,
    syncHashRoute,
    isCurrentRoute,
  };
}
