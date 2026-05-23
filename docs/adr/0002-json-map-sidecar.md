# JSON map sidecar

CodeCharter persists stable base geography in a JSON sidecar. The current default path is `.codecharter/codecharter.json`; the CLI also recognizes root `codecharter.json` and legacy `codemap.json` where compatibility code needs it. JSON is easy for humans, Codex, tests, web apps, and CLIs to inspect and consume, which matters more for the first version than storage density or query performance.

## Considered Options

- JSON sidecar at `.codecharter/codecharter.json`.
- SQLite or another indexed local store.
- Generated tile files only.

## Consequences

The JSON sidecar becomes the first public contract for address resolution and reviewable map diffs. If scale later requires faster lookup or smaller payloads, derived indexes can be generated from the JSON sidecar without replacing it as the canonical base map.
