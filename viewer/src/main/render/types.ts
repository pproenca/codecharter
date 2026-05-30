/**
 * Shared geometry, map, activity, and source-panel types for the viewer's
 * render model.
 */

export type Point = { x: number; y: number };
export type Bounds = Point & { width: number; height: number };
export type BoxSize = { width: number; height: number };
export type HorizontalBox = { x: number; width: number };
export type View = Point & { scale: number };
export type Viewport = { width: number; height: number };

export type Rgb = readonly [number, number, number];
export type PaletteColor = { fill: Rgb; stroke: Rgb; label: string };

export type DetailBand = "district" | "neighborhood" | "block" | "parcel" | "source";

export type GeoAddress = { geohash: string; lat?: number; lon?: number };

type MapBaseTarget = {
  path: string;
  name?: string;
  bounds?: Bounds;
  geo?: GeoAddress;
  lineCount?: number;
};

export type MapFile = MapBaseTarget & {
  maxLineLength?: number;
  extension?: string;
  targetType?: "file";
};

export type MapFolder = MapBaseTarget & {
  children?: { folders?: string[]; files?: string[] };
  growthArea?: Bounds;
  targetType?: "folder";
};

export type MapTarget = MapFile | MapFolder;
export type MapTargetRecord<T extends MapTarget = MapTarget> = Record<string, T>;

export type CodecharterMap = {
  files?: MapTargetRecord<MapFile>;
  folders?: MapTargetRecord<MapFolder>;
  codePlane?: { bounds?: Bounds };
};

export type MapTargetType = "file" | "folder" | "annotation" | "activity";
export type TargetHit = (MapFile & { targetType: "file" }) | (MapFolder & { targetType: "folder" });
export type ActionHit = { targetType: MapTargetType };
export type MapActionType =
  | "clearSelection"
  | "focusAnnotation"
  | "focusFile"
  | "focusFolder"
  | "focusPlace"
  | "inspectFile"
  | "inspectFolder"
  | "noMatch"
  | "selectActivity"
  | "selectFile"
  | "selectFolder";
export type MapAction =
  | { type: "clearSelection" }
  | { type: "focusAnnotation" }
  | { type: "focusFile"; zoomPadding?: number }
  | { type: "focusFolder"; zoomPadding?: number }
  | { type: "focusPlace" }
  | { type: "inspectFile" }
  | { type: "inspectFolder" }
  | { type: "noMatch" }
  | { type: "selectActivity" }
  | { type: "selectFile" }
  | { type: "selectFolder" };
export type MapActionOf<T extends MapActionType> = Extract<MapAction, { type: T }>;

export type MapAnnotationPlace = {
  id?: string;
  kind?: string;
  name?: string;
  comment?: string;
  deepLink?: string;
  browserHash?: string;
  coveringSet?: string[];
  resolvedTargets?: unknown[];
  level?: string;
  spatialFrame?: { level?: string; corners?: { northWest?: string } };
  geometry?: { bounds?: Bounds };
  targetType?: "annotation";
};

export type NamedPlace = MapAnnotationPlace;

export type SearchContext = {
  map: CodecharterMap;
  namedPlaces: NamedPlace[];
  query: string;
};

export type SearchMatch =
  | {
      type: "annotation";
      label?: string;
      place: NamedPlace;
      target: NamedPlace & { targetType: "annotation" };
    }
  | { type: "namedPlace"; label?: string; place: NamedPlace; target: null }
  | { type: "file"; label?: string; file: MapFile }
  | { type: "folder"; label?: string; folder: MapFolder };

export type FogState = "visible" | "explored" | "unexplored";

type ActivityAddressFragment = { bounds?: Bounds };
export type ActivityAddress = {
  path?: string;
  deepLink?: string;
  geohash?: string;
  bounds?: Bounds;
  fragments?: ActivityAddressFragment[];
  targetType?: MapRouteKind;
  lineRange?: { start: number; end?: number };
  tokenRange?: { start: number; end?: number };
};

export type ActivityState = "reading" | "editing" | "testing" | "reviewing";
export type ActivityStateInput = string | undefined;

export type ActivityEvent = {
  id?: string;
  agentId?: string;
  threadId?: string;
  sessionId?: string;
  timestamp?: string;
  activityState?: ActivityStateInput;
  path?: string;
  address?: ActivityAddress;
  note?: string;
  targetType?: "activity";
  viewerFogState?: Extract<FogState, "visible" | "explored">;
};

export type ActivityFogOptions = { now?: number; maxAgeMinutes?: number };
export type ActivityFogState = {
  files: Map<string, FogState>;
  folders: Map<string, FogState>;
  visitedFiles: Set<string>;
  visibleFiles: Set<string>;
};

export type SourceLine = { number: number | string; text: string };
export type SourceRange = {
  path?: string;
  lineRange?: { start: number; end: number };
  lines?: SourceLine[];
};
export type SourceCache = Map<string, SourceRange>;

export type MapRouteKind = "folder" | "file" | "lineRange" | "tokenRange";
export type MapRoute =
  | { type: "annotation"; id: string; params: URLSearchParams }
  | { type: "selection"; params: URLSearchParams }
  | { type: "map"; kind: MapRouteKind; locator: string; params: URLSearchParams };
export type MapHashRoute = Extract<MapRoute, { type: "map" }>;

export type DragState = { type: "pan"; view: View; start: Point };
export type DraftSelection = { type: "rect"; bounds: Bounds };
export type InteractionState = {
  drawing?: boolean;
  panning?: boolean;
  spacePanning?: boolean;
  dragging?: { type: "draw" | "pan" | "select" } | null;
};

export type ActivitySummary = {
  key: string;
  event: ActivityEvent;
  firstIndex: number;
  firstTimestamp: number;
  latestIndex: number;
  latestTimestamp: number;
};

export type ActivityFeedItem = { event: ActivityEvent; timestamp: number };

export type TrailSegment = {
  start: Point;
  control1: Point;
  control2: Point;
  end: Point;
};

export type OrganicRegionEdge = readonly [
  side: string,
  reversed: boolean,
  point: (bounds: Bounds, t: number, inset: number) => Point,
];

export type KeyboardEventLike = {
  key?: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  repeat?: boolean;
};

export type DocumentKeyboardContext = {
  textEntry?: boolean;
  buttonTarget?: boolean;
  hasSelectedAnnotation?: boolean;
  hasResolvedSelection?: boolean;
};

export type LineRange = { start?: number; end?: number };

export type ActivityHitOptions = {
  radiusX?: number;
  radiusY?: number;
  now?: number;
  maxAgeMinutes?: number;
};

export type ActivityTissueEncoding = { selected?: boolean };
