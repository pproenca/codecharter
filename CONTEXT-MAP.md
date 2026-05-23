# Context Map

CodeCharter uses a multi-context documentation layout. Read the root context
first for product language, then read the package context that matches the files
you are changing.

## Contexts

| Area | Paths | Context | ADRs |
| --- | --- | --- | --- |
| Product and shared map language | `README.md`, `AGENTS.md`, `docs/`, root config | `CONTEXT.md` | `docs/adr/` |
| Core engine, CLI, server, and data model | `core/` | `core/CONTEXT.md` | `docs/adr/` |
| Browser viewer and render model | `viewer/` | `viewer/CONTEXT.md` | `docs/adr/` |
| Local issue and scratch workspace | `.scratch/`, `docs/agents/` | `CONTEXT.md` | `docs/adr/` |

## Reading Rules

- Always read `CONTEXT.md` before using domain terms in issues, plans, reviews,
  or code comments.
- Read `core/CONTEXT.md` before changing `core/src/main/**`,
  `core/bin/codemap.mts`, or core tests.
- Read `viewer/CONTEXT.md` before changing `viewer/src/main/**`,
  `viewer/web/**`, or viewer build output.
- Read ADRs in `docs/adr/` when a change affects stable addresses, sidecar
  storage, geohash map levels, deep links, activity telemetry, or discovery fog.
- If a change spans `core` and `viewer`, use root language for cross-package
  concepts and package language for implementation details.
