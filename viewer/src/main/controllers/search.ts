/**
 * Map-search controller: query → match → focus. The search form's submit feeds a
 * query through the pure `mapSearchMatch`/`mapSearchAction` render-model helpers,
 * then this controller focuses the resulting place/file/folder by reusing the
 * app-owned camera + selection callbacks and the already-constructed editing
 * controller. It derives every target from the shared map/named-places state
 * (read via injected accessors) and never builds a second identity model; only
 * the search-result text and inspector labels are written. The pure match/action/
 * geometry helpers are imported directly (no injection), matching `routing.ts`.
 */

import {
  boundsCenter,
  folderDisplayName,
  mapSearchAction,
  mapSearchMatch,
} from "../render/index.ts";
import type {
  Bounds,
  CodecharterMap,
  MapActionOf,
  MapAnnotationPlace,
  MapFile,
  NamedPlace,
  Point,
  SearchMatch,
  TargetHit,
} from "../render/index.ts";

type PlaceSearchMatch = Extract<SearchMatch, { type: "annotation" | "namedPlace" }>;
type FileSearchMatch = Extract<SearchMatch, { type: "file" }>;
type FolderSearchMatch = Extract<SearchMatch, { type: "folder" }>;
type SearchAction = MapActionOf<"noMatch" | "focusPlace" | "focusFile" | "focusFolder">;
type AnnotationHit = NamedPlace & { targetType: "annotation" };

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

type SearchControls = {
  searchInput: (HTMLElement & { value?: string }) | null;
  searchResult: HTMLElement | null;
  inspectorTitle: HTMLElement | null;
  inspectorSubtitle: HTMLElement | null;
};

export type SearchControllerDeps = {
  // State accessors (the shared semantic state stays in app.ts).
  getMap: () => CodecharterMap | null;
  getNamedPlaces: () => NamedPlace[];
  // A focused place is an annotation target; a focused folder is a TargetHit.
  setSelectedTarget: (target: TargetHit | AnnotationHit | null) => void;

  // Controls (stable DOM singletons passed by reference).
  controls: SearchControls;

  // App-owned callbacks (stay in app.ts, injected).
  zoomToBounds: (bounds: Bounds, paddingFactor?: number) => void;
  zoomToReadableFile: (file: MapFile) => void;
  selectMapTarget: (point: Point) => Promise<void>;
  render: () => void;
  setText: (element: HTMLElement | null, value: string) => void;

  // Cross-controller calls (already-constructed editing controller, injected).
  editing: {
    selectedAnnotation: () => AnnotationHit | null;
    selectAnnotation: (annotation: MapAnnotationPlace) => void;
  };
};

export type SearchController = ReturnType<typeof createSearchController>;

export function createSearchController(deps: SearchControllerDeps) {
  async function handleSubmit(event: Event) {
    event.preventDefault();
    const query = deps.controls.searchInput?.value;
    const searchQuery = query ?? "";
    const map = deps.getMap();
    if (!map || !searchQuery.trim()) {
      return;
    }
    const match = mapSearchMatch(map, deps.getNamedPlaces(), searchQuery);
    const action = mapSearchAction(match);
    await handleMapSearchAction(action, match);
  }

  async function handleMapSearchAction(action: SearchAction, match: SearchMatch | null) {
    switch (action.type) {
      case "noMatch":
        setSearchResult("No matching place found.");
        return;
      case "focusPlace":
        if (!match || (match.type !== "annotation" && match.type !== "namedPlace")) {
          return;
        }
        focusPlaceSearchMatch(match);
        return;
      case "focusFile":
        if (match?.type === "file") {
          await focusFileSearchMatch(match);
        }
        return;
      case "focusFolder":
        if (match?.type === "folder") {
          focusFolderSearchMatch(match);
        }
    }
  }

  function focusPlaceSearchMatch(match: PlaceSearchMatch) {
    if (!hasGeometryBounds(match.place)) {
      return;
    }
    deps.zoomToBounds(match.place.geometry.bounds, 1.35);
    setSearchResult(match.label ?? "");
    deps.setSelectedTarget(match.target);
    const annotation = deps.editing.selectedAnnotation();
    if (annotation) {
      deps.editing.selectAnnotation(annotation);
    }
    deps.render();
  }

  async function focusFileSearchMatch(match: FileSearchMatch) {
    if (!hasBounds(match.file)) {
      return;
    }
    deps.zoomToReadableFile(match.file);
    await deps.selectMapTarget(boundsCenter(match.file.bounds));
    setSearchResult(match.label ?? "");
  }

  function focusFolderSearchMatch(match: FolderSearchMatch) {
    if (!hasBounds(match.folder)) {
      return;
    }
    deps.zoomToBounds(match.folder.bounds, 1.6);
    deps.setSelectedTarget({ ...match.folder, targetType: "folder" });
    deps.setText(deps.controls.inspectorTitle, folderDisplayName(match.folder));
    deps.setText(
      deps.controls.inspectorSubtitle,
      `folder: ${match.folder.path || "."} | ${match.folder.geo?.geohash ?? "unresolved"}`,
    );
    setSearchResult(match.label ?? "");
    deps.render();
  }

  function setSearchResult(message: string) {
    if (deps.controls.searchResult) {
      deps.controls.searchResult.textContent = message;
    }
  }

  return {
    handleSubmit,
  };
}
