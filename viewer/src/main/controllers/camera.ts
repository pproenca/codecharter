/**
 * Camera interaction controller: wheel zoom/pan, keyboard/double-click zoom, and
 * the viewport center. It owns the camera *operations* over the shared view; the
 * view itself stays in the app state (the render loop reads it), accessed through
 * the injected `getView`/`setView` so this module has no DOM or global coupling
 * beyond the dependencies it is handed. Pure projection/clamp math lives in
 * `render/camera.ts` (and is unit-tested there).
 */

import { panViewByScreenDelta, zoomViewAt } from "../render/camera.ts";
import type { Point, View, Viewport } from "../render/types.ts";

const WHEEL_LINE_HEIGHT_PX = 16;
const WHEEL_ZOOM_SENSITIVITY = 0.0025;

export type CameraControllerDeps = {
  getView: () => View;
  /** Assign the view without scheduling a render (used by the wheel-pan path). */
  setView: (view: View) => void;
  /** Cancel any running camera animation, assign, and render immediately. */
  setViewImmediate: (view: View) => void;
  animateViewTo: (view: View) => void;
  viewportSize: () => Viewport;
  canvasClientSize: () => Viewport;
};

export type CameraController = ReturnType<typeof createCameraController>;

export function createCameraController(deps: CameraControllerDeps) {
  function viewportCenter(): Point {
    const { width, height } = deps.canvasClientSize();
    return { x: width / 2, y: height / 2 };
  }

  function normalizeWheelDelta(delta: number, deltaMode: number): number {
    if (!Number.isFinite(delta)) {
      return 0;
    }
    if (deltaMode === WheelEvent.DOM_DELTA_LINE) {
      return delta * WHEEL_LINE_HEIGHT_PX;
    }
    if (deltaMode === WheelEvent.DOM_DELTA_PAGE) {
      return delta * deps.canvasClientSize().height;
    }
    return delta;
  }

  function wheelZoomFactor(event: WheelEvent): number {
    return Math.exp(-normalizeWheelDelta(event.deltaY, event.deltaMode) * WHEEL_ZOOM_SENSITIVITY);
  }

  function zoomAt(screenAnchor: Point, factor: number, { animate = false } = {}): void {
    const nextView = zoomViewAt(deps.getView(), screenAnchor, factor, deps.viewportSize());
    if (animate) {
      deps.animateViewTo(nextView);
    } else {
      deps.setViewImmediate(nextView);
    }
  }

  function panByWheel(event: WheelEvent): void {
    const deltaX = normalizeWheelDelta(event.deltaX, event.deltaMode);
    const deltaY = normalizeWheelDelta(event.deltaY, event.deltaMode);
    deps.setView(
      panViewByScreenDelta(deps.getView(), { x: deltaX, y: deltaY }, deps.viewportSize()),
    );
  }

  return { viewportCenter, wheelZoomFactor, zoomAt, panByWheel };
}
