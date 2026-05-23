/**
 * Map target resolution: search matching, hash-route → target lookup, pointer
 * hit-testing for files/folders/annotations, selection-panel copy, and hover
 * labels. Geohash lookups use prefix containment (BR: geohash-grid model).
 */
import type {
  ActionHit,
  ActivityAddress,
  ActivityEvent,
  ActivityStateInput,
  CodecharterCodemap,
  GeoAddress,
  MapAction,
  MapFile,
  MapFolder,
  MapRoute,
  MapTarget,
  MapTargetRecord,
  NamedPlace,
  Point,
  SearchContext,
  SearchMatch,
  TargetHit,
} from "./types.ts";
import {
  actionFor,
  boundsCenter,
  compareTargetAreaThenPath,
  containsBoundsPoint,
  lastPathSegment,
  normalizeMapPath,
  objectValues,
} from "./primitives.ts";
import { normalizeActivityState, shortActivityId } from "./activity.ts";

const MAP_ROUTE_FOCUS_ACTIONS: Map<string, MapAction> = new Map([
  ["file", { type: "focusFile", zoomPadding: 1.35 }],
  ["folder", { type: "focusFolder", zoomPadding: 1.6 }],
]);

const MAP_SEARCH_ACTIONS: Map<SearchMatch["type"], MapAction> = new Map([
  ["annotation", { type: "focusPlace" }],
  ["namedPlace", { type: "focusPlace" }],
  ["file", { type: "focusFile" }],
  ["folder", { type: "focusFolder" }],
]);

const MAP_SEARCH_MATCHERS: Array<(context: SearchContext) => SearchMatch | null> = [
  namedPlaceSearchMatch,
  fileSearchMatch,
  folderSearchMatch,
];

export function mapRouteTarget(codemap: CodecharterCodemap, route: MapRoute): TargetHit | null {
  const path = route.params?.get("path");
  if (path) return mapTargetForPath(codemap, path);
  return mapTargetForGeohash(codemap, route.locator, route.kind);
}

export function hashRouteFocusIntent(route: MapRoute | null | undefined, { hasMap = true } = {}) {
  if (!route || !hasMap) return null;
  if (route.type === "annotation") return { type: "annotation", id: route.id };
  if (route.type === "selection") return { type: "selection", params: route.params };
  if (route.type === "map") return { type: "map", route };
  return null;
}

export function mapRouteFocusAction(target: ActionHit | null | undefined) {
  if (!target) return null;
  return actionFor(MAP_ROUTE_FOCUS_ACTIONS, target.targetType);
}

export function mapSearchMatch(codemap: CodecharterCodemap, namedPlaces: NamedPlace[], query: string): SearchMatch | null {
  const normalized = String(query ?? "").trim().toLowerCase();
  if (!normalized) return null;

  for (const matcher of MAP_SEARCH_MATCHERS) {
    const match = matcher({ codemap, namedPlaces, query: normalized });
    if (match) return match;
  }

  return null;
}

export function mapSearchAction(match: SearchMatch | null | undefined) {
  if (!match) return { type: "noMatch" };
  return actionFor(MAP_SEARCH_ACTIONS, match.type);
}

export function mapSelectionPanel(target: TargetHit | null | undefined) {
  if (!target) {
    return {
      inspectorTitle: "No place selected",
      inspectorSubtitle: "Click a district, parcel, or activity marker.",
      sourceTitle: "No file selected",
      sourceOutput: "",
    };
  }

  const inspectorTitle = target.targetType === "file" ? target.name : folderDisplayName(target);
  const inspectorSubtitle = `${target.targetType}: ${target.path || "."} | ${target.geo?.geohash ?? "unresolved"}`;
  if (target.targetType === "folder") {
    return {
      inspectorTitle,
      inspectorSubtitle,
      sourceTitle: target.path || ".",
      sourceOutput: "Folder selected.",
    };
  }

  return {
    inspectorTitle,
    inspectorSubtitle,
  };
}

export function reconciledSelectedTarget(codemap: CodecharterCodemap, target: TargetHit | null | undefined): TargetHit | null;
export function reconciledSelectedTarget<T extends ActionHit>(codemap: CodecharterCodemap, target: T | null | undefined): T | TargetHit | null;
export function reconciledSelectedTarget(codemap: CodecharterCodemap, target: NamedPlace | ActivityEvent | null | undefined): NamedPlace | ActivityEvent | null;
export function reconciledSelectedTarget(codemap: CodecharterCodemap, target: TargetHit | NamedPlace | ActivityEvent | null | undefined) {
  if (!target) return null;
  if (target.targetType === "file") {
    return codemap.files?.[target.path] ? { ...codemap.files[target.path], targetType: "file" } : null;
  }
  if (target.targetType === "folder") {
    return codemap.folders?.[target.path] ? { ...codemap.folders[target.path], targetType: "folder" } : null;
  }
  return target;
}

export function mapHoverLabel(hit: ActionHit & {
  path?: string;
  name?: string;
  geo?: GeoAddress;
  coveringSet?: string[];
  address?: ActivityAddress;
  activityState?: ActivityStateInput;
  agentId?: string;
  threadId?: string;
  sessionId?: string;
}): string {
  if (hit.targetType === "annotation") {
    return `annotation: ${hit.name} | ${hit.coveringSet?.[0] ?? "unresolved"}`;
  }
  if (hit.targetType === "activity") {
    const thread = hit.threadId ?? hit.sessionId;
    const actor = thread ? `${hit.agentId ?? "agent"} ${shortActivityId(thread)}` : hit.agentId ?? "agent";
    return `activity: ${actor} ${normalizeActivityState(hit.activityState)} | ${hit.address?.geohash ?? "unresolved"}`;
  }
  return `${hit.targetType}: ${hit.path} | ${hit.geo?.geohash ?? "unresolved"}`;
}

export function folderDisplayName(folder: Pick<MapFolder, "path">): string {
  if (!folder.path) return "Codebase";
  return lastPathSegment(folder.path);
}

export function hitTestTargets(codemap: CodecharterCodemap | null | undefined, point: Point): TargetHit | null {
  return hitTestTargetLists(objectValues(codemap?.files ?? {}), objectValues(codemap?.folders ?? {}), point);
}

export function hitTestTargetLists(files: Iterable<MapFile>, folders: Iterable<MapFolder>, point: Point): TargetHit | null {
  const file = bestContainingTarget(files, point);
  if (file) return { ...file, targetType: "file" };

  const folder = bestContainingTarget(folders, point, (target) => Boolean(target.path));
  if (folder) return { ...folder, targetType: "folder" };

  return null;
}

export function hitTestAnnotations(namedPlaces: NamedPlace[], point: Point, { radiusX = 0, radiusY = 0 } = {}): (NamedPlace & { targetType: "annotation" }) | null {
  for (let index = namedPlaces.length - 1; index >= 0; index -= 1) {
    const place = namedPlaces[index];
    if (!place) continue;
    if (place.kind !== "mapAnnotation" || !place.geometry?.bounds) continue;
    if (containsBoundsPoint(place.geometry.bounds, point)) return { ...place, targetType: "annotation" };
    const center = boundsCenter(place.geometry.bounds);
    if (Math.abs(point.x - center.x) <= radiusX && Math.abs(point.y - center.y) <= radiusY) {
      return { ...place, targetType: "annotation" };
    }
  }
  return null;
}

function namedPlaceSearchMatch({ namedPlaces, query }: SearchContext): SearchMatch | null {
  let namedPlace: NamedPlace | undefined;
  for (const place of namedPlaces) {
    if (!String(place?.name ?? "").toLowerCase().includes(query)) continue;
    namedPlace = place;
    break;
  }
  if (!namedPlace?.geometry?.bounds) return null;

  const annotation = namedPlace.kind === "mapAnnotation";
  if (annotation) {
    return {
      type: "annotation",
      label: `Annotation: ${namedPlace.name}`,
      place: namedPlace,
      target: { ...namedPlace, targetType: "annotation" },
    };
  }
  return {
    type: "namedPlace",
    label: `Named place: ${namedPlace.name}`,
    place: namedPlace,
    target: null,
  };
}

function fileSearchMatch({ codemap, query }: SearchContext): SearchMatch | null {
  const file = firstSearchTarget(codemap.files ?? {}, query);
  return file ? { type: "file", label: `File: ${file.path}`, file } : null;
}

function folderSearchMatch({ codemap, query }: SearchContext): SearchMatch | null {
  const folder = firstSearchTarget(codemap.folders ?? {}, query);
  return folder ? { type: "folder", label: `Folder: ${folder.path || "."}`, folder } : null;
}

function firstSearchTarget<T extends MapTarget>(targets: MapTargetRecord<T>, query: string): T | null {
  for (const key in targets) {
    if (!Object.hasOwn(targets, key)) continue;
    const target = targets[key];
    if (!target) continue;
    const path = String(target.path ?? "");
    const geohash = String(target.geo?.geohash ?? "");
    if (path.toLowerCase().includes(query) || geohash.startsWith(query)) return target;
  }
  return null;
}

function mapTargetForPath(codemap: CodecharterCodemap, path: string): TargetHit | null {
  const normalized = normalizeMapPath(path);
  if (codemap.files?.[normalized]) return { ...codemap.files[normalized], targetType: "file" };
  if (codemap.folders?.[normalized]) return { ...codemap.folders[normalized], targetType: "folder" };
  return null;
}

function mapTargetForGeohash(codemap: CodecharterCodemap, geohash: string | undefined, kind: string | undefined): TargetHit | null {
  const targetType = kind === "folder" ? "folder" : "file";
  if (!geohash) return null;
  const targets = targetType === "folder" ? objectValues(codemap.folders ?? {}) : objectValues(codemap.files ?? {});
  let fallback: MapTarget | null = null;
  for (const target of targets) {
    if (targetType === "folder" && !target.path) continue;
    const targetGeohash = target.geo?.geohash;
    if (!targetGeohash) continue;
    if (targetGeohash.startsWith(geohash)) return { ...target, targetType } as TargetHit;
    if (!fallback && geohash.startsWith(targetGeohash)) fallback = target;
  }
  return fallback ? { ...fallback, targetType } as TargetHit : null;
}

function bestContainingTarget<T extends MapTarget>(targets: Iterable<T>, point: Point, accept: (target: T) => boolean = (_target) => true): T | null {
  let best: T | null = null;
  for (const target of targets) {
    if (!target.bounds || !accept(target) || !containsBoundsPoint(target.bounds, point)) continue;
    if (!best || compareTargetAreaThenPath(target, best) < 0) best = target;
  }
  return best;
}
