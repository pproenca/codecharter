# Non-blocking activity telemetry

CodeCharter will treat agent activity as best-effort telemetry. `POST /api/activity` accepts an event immediately, returns `202`, and records the event in the in-memory Activity Stream. If an event is malformed or refers to an unmapped path, the server drops it after logging instead of blocking the caller.

The real-time Activity Stream is memory-backed so the UI can poll it without per-event disk I/O. The normal `codecharter dev` producer resolves changed paths to Map Addresses before posting activity, so the server can accept pre-resolved events without reading the Map Sidecar. From time to time, the server appends accumulated events to a JSONL Activity Archive. The code default is `.codecharter/activity.jsonl`; this repo's current local config routes Codex activity to `.scratch/codecharter/activity.jsonl`. The archive is not read on the hot path and has no hard file-size check; developers can rotate or delete it as local scratch data. The in-memory archive backlog is bounded, so slow disk can lose old archive candidates instead of blocking live work.

The local dogfood path is `codecharter dev`: it regenerates the Map Sidecar from the current repository, serves the web app, and starts an Activity Producer that observes `git status --porcelain=v1 -z` plus `git diff --unified=0`. When the observed diff signature changes, the dev process refreshes the Map Sidecar and updates its in-memory map before posting activity, so newly created files can receive stable Map Addresses without a server restart. The producer converts changed paths and line ranges through the Address Resolver, so the renderer receives normal Map Addresses rather than renderer-specific coordinates.

## Considered Options

- Require explicit `codecharter activity ...` calls from every agent action.
- Stream filesystem/git activity through a best-effort dev watcher.
- Make `/api/activity` synchronously rewrite a JSON file or fail the caller when persistence fails.

## Consequences

Developer and agent work can continue when the map server is unavailable, slow, or unable to resolve a path. Activity may be lossy, but every accepted event still goes through the same deterministic Map Address contract as named places, deep links, and drawn selections.

Because activity is a volatile Map Layer, it remains outside the Map Sidecar (`.codecharter/codecharter.json` by default). The Map Sidecar stays the canonical stable geography; the Activity Stream and Activity Archive are separate timeline overlays that can be cleared, replayed, rotated, or replaced without changing coordinates.

Activity also drives the integrated discovery rendering. When Activity & Discovery is enabled, the renderer derives Age of Empires-style fog states from the same Activity Stream and Activity Archive:

- `unexplored`: no accepted activity has resolved to the File.
- `explored`: activity resolved to the File in the past, but there is no live event within the current Activity live window.
- `visible`: live/recent activity resolved to the File, or the File is temporarily selected for inspection.

Discovery is derived state, not persisted in the Map Sidecar. File state is primary because File is the first stable map unit; Folder and Region state rolls up from child File activity. The browser precomputes Sets and Maps for visited Files, visible Files, and Folder rollups when activity or the map changes, so the Canvas render path performs constant-time fog lookups per drawn item instead of scanning activity for every File.
