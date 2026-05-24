# Viewer Guide

This package owns the browser Code Map experience. Read `../CONTEXT-MAP.md`,
`../CONTEXT.md`, and `CONTEXT.md` before viewer work.

## Ownership

- `viewer/src/main/app.ts` owns DOM wiring, canvas events, API polling,
  selection editing, annotation actions, source panel requests, and camera
  state.
- `viewer/src/main/render/` owns render-model derivations for camera, level of
  detail, activity, fog, source panels, targets, and drawing primitives.
- Canonical map identity belongs to the Map Sidecar and core API responses, not
  browser-only state.

## Contracts

- Browser hash routes are UI navigation. Use `codecharter://` Deep Links for
  clipboard, prompt, and cross-tool references.
- Source text, labels, activity overlays, and discovery fog must not resize map
  geography.
- Discovery Fog is derived state over files and folder rollups. Do not persist
  it into the Map Sidecar.
- Activity Trails and Activity Feed are visual summaries, not audit logs or
  canonical history.

## Implementation

- Keep render-model helpers deterministic and small enough to test or inspect
  independently.
- Precompute sets and maps when activity, selections, or map data changes;
  avoid scanning all activity inside per-target draw paths.
- Keep fixed-format UI elements dimensionally stable so labels, hover states,
  and source snippets do not shift the map unexpectedly.
- UI work should stay quiet and tool-like: dense, scannable, and focused on map
  navigation rather than marketing layout.

## Tests And Proof

- Viewer behavior tests belong in `viewer/src/test/`.
- Prefer tests around render-model helpers for LOD, target reconciliation,
  source-panel formatting, activity, fog, and route parsing.
- Use `pnpm exec tsx --test viewer/src/test/<file>.test.ts` for focused viewer
  proof.
- Run `pnpm build` after frontend or bundle changes.
- Inspect the viewer in a browser when a change is visual or interactive.
