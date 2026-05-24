/**
 * Camera projection, zoom/pan transforms, keyboard navigation, and pointer
 * interaction state (BR-019 scale clamp). All world coordinates are in the unit
 * square; screen coordinates are pixels relative to the viewport top-left.
 */
import type {
  Bounds,
  DocumentKeyboardContext,
  DraftSelection,
  DragState,
  InteractionState,
  KeyboardEventLike,
  MapActionOf,
  MapFile,
  MapTargetType,
  Point,
  View,
  Viewport,
  ActionHit,
} from "./types.ts";
import {
  KEYBOARD_PAN_PIXELS,
  MAP_MAX_SCALE,
  MAP_MIN_SCALE,
  SOURCE_TEXT_MIN_LINE_HEIGHT,
  SOURCE_TEXT_MIN_WIDTH,
  SOURCE_TEXT_ZOOM_HEADROOM,
} from "./constants.ts";
import { clamp } from "./primitives.ts";

type DoubleClickAction = MapActionOf<
  "focusAnnotation" | "selectFolder" | "selectFile" | "selectActivity"
>;
type TargetSelectionAction = MapActionOf<
  "clearSelection" | "focusAnnotation" | "selectActivity" | "inspectFolder" | "inspectFile"
>;

const DOUBLE_CLICK_TARGET_ACTIONS = {
  annotation: { type: "focusAnnotation" },
  folder: { type: "selectFolder" },
  file: { type: "selectFile" },
  activity: { type: "selectActivity" },
} satisfies Record<MapTargetType, DoubleClickAction>;

const MAP_TARGET_SELECTION_ACTIONS = {
  annotation: { type: "focusAnnotation" },
  activity: { type: "selectActivity" },
  folder: { type: "inspectFolder" },
  file: { type: "inspectFile" },
} satisfies Record<MapTargetType, Exclude<TargetSelectionAction, MapActionOf<"clearSelection">>>;

export function labelBoxesOverlap(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function worldToScreenPoint(point: Point, view: View, viewport: Viewport): Point {
  return {
    x: (point.x - view.x) * viewport.width * view.scale,
    y: (point.y - view.y) * viewport.height * view.scale,
  };
}

export function screenToWorldPoint(point: Point, view: View, viewport: Viewport): Point {
  return {
    x: point.x / (viewport.width * view.scale) + view.x,
    y: point.y / (viewport.height * view.scale) + view.y,
  };
}

export function screenBoundsForView(bounds: Bounds, view: View, viewport: Viewport): Bounds {
  const point = worldToScreenPoint({ x: bounds.x, y: bounds.y }, view, viewport);
  return {
    x: point.x,
    y: point.y,
    width: bounds.width * viewport.width * view.scale,
    height: bounds.height * viewport.height * view.scale,
  };
}

export function isScreenBoxVisible(box: Bounds, viewport: Viewport): boolean {
  return (
    box.x + box.width >= 0 &&
    box.y + box.height >= 0 &&
    box.x <= viewport.width &&
    box.y <= viewport.height
  );
}

export function zoomViewAt(
  view: View,
  screenAnchor: Point,
  factor: number,
  viewport: Viewport,
  minScale = MAP_MIN_SCALE,
  maxScale = MAP_MAX_SCALE,
): View {
  const before = screenToWorldPoint(screenAnchor, view, viewport);
  const scale = clamp(view.scale * factor, minScale, maxScale);
  const after = screenToWorldPoint(screenAnchor, { ...view, scale }, viewport);
  return {
    x: view.x + before.x - after.x,
    y: view.y + before.y - after.y,
    scale,
  };
}

export function panViewByScreenDelta(view: View, delta: Point, viewport: Viewport): View {
  return {
    ...view,
    x: view.x + delta.x / (viewport.width * view.scale),
    y: view.y + delta.y / (viewport.height * view.scale),
  };
}

export function panViewForDrag(drag: DragState, screen: Point, viewport: Viewport): View {
  return panViewByScreenDelta(
    drag.view,
    {
      x: drag.start.x - screen.x,
      y: drag.start.y - screen.y,
    },
    viewport,
  );
}

export type CanvasKeyboardAction =
  | { type: "pan"; delta: Point }
  | { type: "zoomIn" }
  | { type: "zoomOut" }
  | { type: "fitCodebase" }
  | { type: "selectCenter" };

export function canvasKeyboardAction(event: KeyboardEventLike): CanvasKeyboardAction | null {
  const keyDeltas: Record<string, Point> = {
    ArrowRight: { x: KEYBOARD_PAN_PIXELS, y: 0 },
    ArrowLeft: { x: -KEYBOARD_PAN_PIXELS, y: 0 },
    ArrowDown: { x: 0, y: KEYBOARD_PAN_PIXELS },
    ArrowUp: { x: 0, y: -KEYBOARD_PAN_PIXELS },
  };
  const key = event.key;
  if (!key) {
    return null;
  }
  const delta = keyDeltas[key];
  if (delta) {
    return { type: "pan", delta };
  }
  if (key === "+" || key === "=") {
    return { type: "zoomIn" };
  }
  if (key === "-" || key === "_") {
    return { type: "zoomOut" };
  }
  if (key === "0") {
    return { type: "fitCodebase" };
  }
  if (key === "Enter") {
    return { type: "selectCenter" };
  }
  return null;
}

export type DocumentKeyboardAction =
  | { type: "startSpacePan" }
  | { type: "cancelInteraction" }
  | { type: "saveSelection" }
  | { type: "copyAnnotationPrompt" }
  | { type: "deleteAnnotation" };

export function documentKeyboardAction(
  event: KeyboardEventLike,
  context: DocumentKeyboardContext = {},
): DocumentKeyboardAction | null {
  const commandModifier = event.metaKey || event.ctrlKey;
  const {
    textEntry = false,
    buttonTarget = false,
    hasSelectedAnnotation = false,
    hasResolvedSelection = false,
  } = context;

  if (!textEntry && !buttonTarget && isSpaceKeyEvent(event) && !event.repeat) {
    return { type: "startSpacePan" };
  }
  if (event.key === "Escape") {
    return { type: "cancelInteraction" };
  }
  if (commandModifier && event.key === "Enter" && (hasResolvedSelection || hasSelectedAnnotation)) {
    return { type: "saveSelection" };
  }
  if (!textEntry && commandModifier && event.key?.toLowerCase() === "c" && hasSelectedAnnotation) {
    return { type: "copyAnnotationPrompt" };
  }
  if (
    !textEntry &&
    (event.key === "Delete" || event.key === "Backspace") &&
    hasSelectedAnnotation
  ) {
    return { type: "deleteAnnotation" };
  }
  return null;
}

export function doubleClickMapAction(hit: ActionHit | null | undefined): DoubleClickAction | null {
  if (!hit) {
    return null;
  }
  return { ...DOUBLE_CLICK_TARGET_ACTIONS[hit.targetType] };
}

export function mapTargetSelectionAction(hit: ActionHit | null | undefined): TargetSelectionAction {
  if (!hit) {
    return { type: "clearSelection" };
  }
  return { ...MAP_TARGET_SELECTION_ACTIONS[hit.targetType] };
}

export function isSpaceKeyEvent(event: KeyboardEventLike): boolean {
  return event.code === "Space" || event.key === " " || event.key === "Spacebar";
}

export function viewForBounds(
  bounds: Bounds,
  _viewport: Viewport,
  paddingFactor = 1.2,
  minScale = MAP_MIN_SCALE,
  maxScale = MAP_MAX_SCALE,
): View {
  const scaleX = 1 / Math.max(bounds.width * paddingFactor, 0.001);
  const scaleY = 1 / Math.max(bounds.height * paddingFactor, 0.001);
  const scale = clamp(Math.min(scaleX, scaleY), minScale, maxScale);
  return {
    scale,
    x: bounds.x + bounds.width / 2 - 0.5 / scale,
    y: bounds.y + bounds.height / 2 - 0.5 / scale,
  };
}

export function viewForReadableFile(
  file: MapFile,
  viewport: Viewport,
  lineRatio = 0.5,
  minScale = MAP_MIN_SCALE,
  maxScale = MAP_MAX_SCALE,
): View {
  const bounds = file.bounds ?? { x: 0, y: 0, width: 1, height: 1 };
  const lineCount = file.lineCount ?? 0;
  const widthScale = SOURCE_TEXT_MIN_WIDTH / Math.max(bounds.width * viewport.width, 0.001);
  const lineScale =
    (SOURCE_TEXT_MIN_LINE_HEIGHT * Math.max(1, lineCount)) /
    Math.max(bounds.height * viewport.height, 0.001);
  const scale = clamp(
    Math.max(widthScale, lineScale) * SOURCE_TEXT_ZOOM_HEADROOM,
    minScale,
    maxScale,
  );
  const screenWidth = bounds.width * viewport.width * scale;
  const focusX = bounds.x + bounds.width / 2;
  const focusY = bounds.y + bounds.height * clamp(lineRatio, 0, 1);
  return {
    scale,
    x:
      screenWidth > viewport.width * 0.9
        ? bounds.x - 24 / (viewport.width * scale)
        : focusX - 0.5 / scale,
    y: focusY - 0.5 / scale,
  };
}

export function interactionModeUiState({
  drawing = false,
  panning = false,
  spacePanning = false,
  dragging = null,
}: InteractionState = {}) {
  const draggingPan = dragging?.type === "pan";
  return {
    selectActive: !drawing && !panning && !spacePanning && !draggingPan,
    panActive: panning || spacePanning || draggingPan,
    drawActive: drawing,
    panningMode: panning && !spacePanning && !draggingPan,
    drawingMode: drawing && !spacePanning,
    spacePanningMode: spacePanning,
    panning: draggingPan,
  };
}

export function draftSelectionFromDrag(start: Point, current: Point): DraftSelection {
  return {
    type: "rect",
    bounds: {
      x: start.x,
      y: start.y,
      width: current.x - start.x,
      height: current.y - start.y,
    },
  };
}

export function isUsableDraftSelection(
  selection: DraftSelection | null | undefined,
  { viewport, scale, minPixels = 4 }: { viewport: Viewport; scale: number; minPixels?: number },
): boolean {
  if (!selection) {
    return false;
  }
  const bounds = selection.bounds;
  const width = Math.abs(bounds.width) * viewport.width * scale;
  const height = Math.abs(bounds.height) * viewport.height * scale;
  return width >= minPixels && height >= minPixels;
}
