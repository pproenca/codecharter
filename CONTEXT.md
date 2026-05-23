# CodeCharter Context

CodeCharter turns a repository into a deterministic, geohash-addressed 2D code
map. The current codebase is a Node >=22, ESM, npm-workspaces monorepo with a
core engine package and a browser viewer package.

This root context defines product-wide language. For package-specific language,
start with `CONTEXT-MAP.md`, then read `core/CONTEXT.md` or
`viewer/CONTEXT.md` as needed.

## Current Architecture

- `@codecharter/core` in `core/`: codemap generation, geohash addressing,
  address resolution, selections, named places, activity telemetry, CLI setup,
  and the hardened localhost HTTP server.
- `@codecharter/viewer` in `viewer/`: canvas SPA, hash routes, render model,
  interaction state, source inspection, activity trails, and discovery fog.
- `.codecharter/codecharter.json`: generated Map Sidecar for the current repo.
- `.codecharter/named-places.json`: local Named Places Store.
- Activity archives are local telemetry. The code default is
  `.codecharter/activity.jsonl`; this repo's current `.codecharter/config.json`
  routes Codex activity to `.scratch/codecharter/activity.jsonl`.
- `.scratch/`: gitignored local workspace for issue markdown, screenshots,
  scratch codemaps, and local activity artifacts.

## Language

**Code Map**:
A navigable spatial representation of a codebase. Users pan, zoom, search,
select, name, and inspect code on this surface.
_Avoid_: file tree replacement, diagram export

**Stable Map**:
A Code Map whose existing places remain fixed across regeneration when the
projection contract still matches. Stability protects spatial memory, Deep
Links, Named Places, and activity history.
_Avoid_: auto-reflowed layout, throwaway map

**Map Sidecar**:
The generated JSON record of the stable base geography. It stores folders,
files, bounds, geohash coordinates, map levels, and projection metadata. It does
not store volatile overlays.
_Avoid_: tile cache, activity log

**Code Plane**:
The normalized unit square used for layout. CodeCharter maps code-plane points
to the standard geohash latitude/longitude domain internally while presenting
them as code-space positions.
_Avoid_: literal earth geography

**Map Address**:
A durable reference to a Region, Folder, File, Line Coordinate, Token Range, or
Named Place. A Map Address is backed by a geohash and may include breadcrumbs,
path metadata, and range metadata.
_Avoid_: path-only locator

**Deep Link**:
The portable URI form of a Map Address. The current canonical scheme is
`codecharter://<kind>/<locator>?...`; the parser still accepts legacy
`codemap://` links.
_Avoid_: browser route only, breadcrumb string

**Browser Hash Route**:
The viewer-local route form, such as `#/map/<kind>/<locator>`,
`#/annotation/<id>`, or `#/selection?...`. Browser routes are UI state; Deep
Links are the cross-tool contract.
_Avoid_: canonical address

**Map Level**:
A named scale mapped to geohash precision. Current levels are `world`,
`region`, `folder`, `file`, `code`, `lineRange`, and `tokenRange`.
_Avoid_: arbitrary zoom value

**Region**:
A meaningful area on the Code Map. A Region may come from geohash prefix,
folder geography, a named selection, or a future domain projection.
_Avoid_: directory synonym

**Folder**:
A filesystem container represented as map geography. Folder structure is still
the first neighborhood signal.
_Avoid_: raw directory tree node

**File**:
The first stable map unit. Files occupy areas sized from source content and can
resolve to line or token ranges when zoomed or selected.
_Avoid_: arbitrary blob

**Source Content**:
The text inside a File. Source Content keeps normal line order; it is not packed
spatially inside the file.
_Avoid_: rendered pixels as source of truth

**Line Coordinate**:
A range inside a File based on line numbers. It lets maps, selections, activity,
and source panels refer to specific code spans.
_Avoid_: text pixel coordinate

**Token Range**:
A horizontal range approximation inside a line span. Token ranges let activity
and selections point to changed fragments without changing the base File area.
_Avoid_: tokenizer-owned canonical geometry

**Map Inclusion**:
The rule for deciding which paths appear in the Map Sidecar. Current generation
follows gitignore filtering plus known code/text extensions, with CodeCharter's
own generated artifacts excluded.
_Avoid_: every file on disk

**Map Order**:
The deterministic ordering used during layout. Current generation uses bounded
weighted binary districts with folders before files.
_Avoid_: filesystem iteration order

**Growth Area**:
Reserved or reusable space inside a Folder for future additions. Growth Areas
help incremental regeneration avoid moving existing places.
_Avoid_: random free space

**Repack**:
An explicit layout change that may move existing Map Addresses. Repacking is a
deliberate operation, not the default regeneration behavior.
_Avoid_: background reflow

**Tile**:
A geohash-prefix addressed subset of map targets. Tiles are derived from the Map
Sidecar to load visible geography efficiently.
_Avoid_: source of truth

**Map Layer**:
A visual and queryable layer over the base geography: folders, files, organic
regions, names, selections, annotations, activity, grid, or discovery fog.
_Avoid_: canvas draw pass

**Named Place**:
A saved place in `.codecharter/named-places.json`. Current kinds are drawn
selections, map annotations, and named addresses.
_Avoid_: UI-only bookmark

**Drawn Selection**:
A user-created rectangle on the Code Map. It preserves original geometry and
also carries a geohash Covering Set for lookup.
_Avoid_: screenshot annotation

**Covering Set**:
The geohash-backed set approximating a Drawn Selection or Region for lookup.
Resolution still refines against real map geometry.
_Avoid_: final target list

**Resolved Target**:
A Folder, File, Line Coordinate, or Token Range currently matched by an address
or selection. Resolved Targets may change when the current Map Sidecar changes.
_Avoid_: permanent selection membership

**Selection Resolution**:
The deterministic conversion of selection geometry into targets. Broad levels
resolve to folders or files; code-level selections can resolve to line or token
ranges.
_Avoid_: raw hit test

**Named Places Store**:
The local JSON store for saved selections, annotations, and named addresses.
It changes independently from the Map Sidecar.
_Avoid_: map sidecar section

**Activity Stream**:
The in-memory timeline of accepted agent activity events served to the viewer.
It powers live activity visuals and discovery fog.
_Avoid_: canonical map history

**Activity Archive**:
A local JSONL append-only record of activity events. It is outside the hot path
and may be rotated or deleted without changing map geography.
_Avoid_: required event database

**Activity Producer**:
A hook, watcher, or integration that reports activity. Producers are
best-effort and must not block reading, editing, testing, generating, or serving.
_Avoid_: required build step

**Activity State**:
The visible kind of work an agent is doing: reading, editing, testing, or
reviewing. Legacy `blocked` inputs normalize to reviewing.
_Avoid_: workflow state machine

**Discovery Fog**:
Viewer-derived state over files and folders based on activity: `unexplored`,
`explored`, or `visible`. Discovery fog is render state, not persisted map data.
_Avoid_: persisted coverage metric

## Operating Principles

- The Map Sidecar is the canonical base geography; tiles, fog, source panels,
  activity trails, and named-place overlaps are derived.
- Existing addresses should remain stable unless projection metadata changes or
  an explicit repack is chosen.
- Geohash prefixes are the addressing spine across tiles, addresses, selections,
  named places, and activity.
- The viewer may optimize rendering aggressively, but it should not invent a
  second semantic model for map identity.
- Activity telemetry is lossy by design. Dropping telemetry is better than
  blocking code work.
- Use `codecharter://` in new docs, tests, prompts, and generated messages.
  Accept `codemap://` only as a legacy compatibility input.

## Example Dialogue

Developer: "Where is `core/src/main/geohash.ts` on the map?"

Domain expert: "Resolve the path through the core Address Resolver. It returns
a Map Address with the file's geohash, bounds, breadcrumb, and a
`codecharter://file/...` Deep Link."

Developer: "Why did this file keep the same address after regeneration?"

Domain expert: "The projection metadata still matched, and the Stable Map
reused the previous layout. New and removed files were handled locally where
possible."

Developer: "Does drawing a rectangle select files forever?"

Domain expert: "No. The Drawn Selection geometry is saved, then Selection
Resolution recalculates current Resolved Targets from the active Map Sidecar."

Developer: "Why is activity missing for some edits?"

Domain expert: "Activity Producers are best-effort. Missing telemetry should
not block the server, CLI, or agent workflow."
