# JSON map sidecar

CodeCharter will persist the first stable base geography in a committed JSON sidecar, `codemap.json`. JSON is easy for humans, Codex, tests, web apps, and CLIs to inspect and consume, which matters more for the first version than storage density or query performance.

## Considered Options

- JSON sidecar.
- SQLite or another indexed local store.
- Generated tile files only.

## Consequences

The JSON sidecar becomes the first public contract for address resolution and reviewable map diffs. If scale later requires faster lookup or smaller payloads, derived indexes can be generated from the JSON sidecar without replacing it as the canonical base map.
