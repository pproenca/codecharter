# Viewer Context

`@codecharter/viewer` is the browser package. It owns the canvas SPA, local hash
routes, render model, map interaction, source inspection, activity visuals, and
discovery fog presentation.

## Architecture

- `viewer/src/main/app.ts`: browser application shell. It wires DOM controls,
  canvas rendering, API polling, selection editing, annotation actions, source
  panel requests, camera state, and pointer/keyboard events.
- `viewer/src/main/deep-links.ts`: browser hash-route parsing and construction.
- `viewer/src/main/render/types.ts`: viewer-side map, activity, source, target,
  and interaction types.
- `viewer/src/main/render/camera.ts`: view transforms, keyboard/pointer actions,
  panning, zooming, focus actions, and draft selections.
- `viewer/src/main/render/lod.ts`: detail bands, folder/file visibility, labels,
  visual states, organic regions, and source-text readability.
- `viewer/src/main/render/fog.ts`: activity-derived discovery fog state and
  reveal/veil styling.
- `viewer/src/main/render/activity.ts`: activity normalization, visual encoding,
  hit testing, feeds, trails, live windows, and actor grouping.
- `viewer/src/main/render/source-panel.ts`: source range layout, cache keys,
  formatted source output, and annotation clipboard text.
- `viewer/src/main/render/targets.ts`: route targeting, search, hit testing,
  selected-target reconciliation, and hover/panel presentation.
- `viewer/web/`: source HTML/CSS used by the build.
- `viewer/dist/`: generated bundle output.

## Viewer Language

**Canvas App Shell**:
The DOM and event wiring in `app.ts` that turns render-model outputs into a
usable browser application.
_Avoid_: render model

**Render Model**:
Pure or mostly pure functions in `viewer/src/main/render/` that classify map
targets, compute view transforms, derive fog/activity state, and format panel
data.
_Avoid_: canvas drawing code only

**View**:
The current camera state: code-plane center plus scale.
_Avoid_: browser viewport

**Viewport**:
The screen size available for rendering. Viewport is separate from View.
_Avoid_: camera

**Detail Band**:
The scale-derived rendering band: `district`, `neighborhood`, `block`,
`parcel`, or `source`.
_Avoid_: arbitrary zoom mode

**Organic Region**:
A viewer-derived region outline around folder geography. It helps the map feel
like terrain while staying derived from canonical folder bounds.
_Avoid_: new semantic region

**File Visual State**:
The viewer classification for a file at the current scale and selection state,
such as `source`, `selected`, `landmark`, `aggregate`, `parcel`, or `hidden`.
_Avoid_: file type

**Activity Trail**:
The visible path derived from recent activity events, grouped by actor and
simplified for rendering.
_Avoid_: persisted route

**Activity Feed**:
The recency-ordered UI summary of activity events.
_Avoid_: audit log

**Discovery Fog State**:
The viewer-derived `visible`, `explored`, or `unexplored` state for files and
folder rollups.
_Avoid_: persisted map attribute

**Source Panel**:
The side panel view of source ranges resolved from selection, route, hover, or
target focus.
_Avoid_: editor

**Selected Target**:
The active file, folder, annotation, or activity event in the browser. It must
be reconciled against the latest map and named-place data.
_Avoid_: permanent state

## Rules

- Keep canonical map identity in the Map Sidecar and core API responses. Viewer
  state should derive from that data.
- Keep render-model helpers deterministic and small enough to test or inspect
  independently.
- Do not let source text, labels, or activity overlays resize map geography.
- Prefer constant-time per-target lookups in draw paths; precompute sets/maps
  when activity or map data changes.
- Browser hash routes are UI navigation. Use `codecharter://` Deep Links for
  cross-tool references and clipboard prompts.
- After frontend changes, build the viewer and inspect it in a browser when the
  affected surface is visual or interactive.
