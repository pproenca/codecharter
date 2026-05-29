/**
 * Selection draft + resolve lifecycle: track the in-progress drawn rectangle and
 * resolve it to a server-side selection. The selection *state* (draft/resolved)
 * stays in app state — the render loop and the still-app-owned save/annotation
 * path read it — so this controller operates through injected accessors and a
 * post-resolve UI callback. Pure geometry math is delegated to the unit-tested
 * render/camera.ts helpers.
 *
 * NOTE: the save path (saveSelection) is intentionally NOT here — it is fused
 * with annotation create/edit/copy + clipboard + routing in app.ts and needs a
 * combined editing-controller rearchitecture, tracked separately.
 */

import { draftSelectionFromDrag, isUsableDraftSelection } from "../render/camera.ts";
import type { Bounds, Point, View, Viewport } from "../render/types.ts";

export type DraftSelection = { type: "rect"; bounds: Bounds };
type DrawDrag = { type: "draw"; start: Point; current: Point };

export type SelectionControllerDeps<TResolved extends { geometry: { bounds: Bounds } }> = {
  level: string;
  /** The active drag if it is a draw (else null) — its `current` is updated in place. */
  getDrawDrag: () => DrawDrag | null;
  getDraft: () => DraftSelection | null;
  setDraft: (draft: DraftSelection | null) => void;
  setResolved: (resolved: TResolved) => void;
  getView: () => View;
  viewportSize: () => Viewport;
  resolveSelection: (body: { level: string; geometry: DraftSelection }) => Promise<TResolved>;
  isCurrentRoute: (token: number) => boolean;
  syncSelectionRoute: (bounds: Bounds, level: string) => void;
  /** App-owned UI bundle run after a successful resolve (enable save, status, render). */
  onResolved: () => void;
};

export type SelectionController = ReturnType<typeof createSelectionController>;

export function createSelectionController<TResolved extends { geometry: { bounds: Bounds } }>(
  deps: SelectionControllerDeps<TResolved>,
) {
  function updateDraft(world: Point): void {
    const drag = deps.getDrawDrag();
    if (!drag) {
      return;
    }
    drag.current = world;
    deps.setDraft(draftSelectionFromDrag(drag.start, world));
  }

  function hasUsableDraft(): boolean {
    return isUsableDraftSelection(deps.getDraft(), {
      viewport: deps.viewportSize(),
      scale: deps.getView().scale,
    });
  }

  async function preview({
    routeToken = null,
  }: { routeToken?: number | null } = {}): Promise<void> {
    const draft = deps.getDraft();
    if (!draft) {
      return;
    }
    const resolved = await deps.resolveSelection({ level: deps.level, geometry: draft });
    if (routeToken && !deps.isCurrentRoute(routeToken)) {
      return;
    }
    // The draft may have changed while the request was in flight — drop a stale resolve.
    if (deps.getDraft() !== draft) {
      return;
    }
    deps.setResolved(resolved);
    deps.syncSelectionRoute(resolved.geometry.bounds, deps.level);
    deps.onResolved();
  }

  return { updateDraft, hasUsableDraft, preview };
}
