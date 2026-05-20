# Non-blocking activity telemetry

Codemaps will treat agent activity as best-effort telemetry. `POST /api/activity` accepts an event immediately, returns `202`, and records the event in the in-memory Activity Stream. If an event is malformed or refers to an unmapped path, the server drops it after logging instead of blocking the caller.

The real-time Activity Stream is memory-backed so the UI can poll it without per-event disk I/O. From time to time, the server appends accumulated events to `.scratch/activity-stream.jsonl` as a JSONL Activity Archive. The archive is not read on the hot path and has no hard file-size check; developers can rotate or delete it as local scratch data.

The local dogfood path is `codemap dev`: it regenerates the Map Sidecar from the current repository, serves the web app, and starts an Activity Producer that observes `git status --porcelain=v1 -z` plus `git diff --unified=0`. When the observed diff signature changes, the dev process refreshes the Map Sidecar before posting activity, so newly created files can receive stable Map Addresses without a server restart. The producer converts changed paths and line ranges through the Address Resolver, so the renderer receives normal Map Addresses rather than renderer-specific coordinates.

## Considered Options

- Require explicit `codemap activity ...` calls from every agent action.
- Stream filesystem/git activity through a best-effort dev watcher.
- Make `/api/activity` synchronously rewrite a JSON file or fail the caller when persistence fails.

## Consequences

Developer and agent work can continue when the map server is unavailable, slow, or unable to resolve a path. Activity may be lossy, but every accepted event still goes through the same deterministic Map Address contract as named places, deep links, and drawn selections.

Because activity is a volatile Map Layer, it remains outside `codemap.json`. The Map Sidecar stays the canonical stable geography; the Activity Stream and Activity Archive are separate timeline overlays that can be cleared, replayed, rotated, or replaced without changing coordinates.
