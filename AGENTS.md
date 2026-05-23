# CodeCharter

CodeCharter turns a codebase into a deterministic, geohash-addressed 2D map.

The current codebase is a Node >=22 npm-workspaces monorepo:

- `@codecharter/core` in `core/`: codemap generation, geohash addressing, address resolution, selections, activity telemetry, CLI setup, and the hardened localhost server.
- `@codecharter/viewer` in `viewer/`: canvas SPA, render model, hash routes, activity trails, discovery fog, and source inspection.

## Working Direction

- Treat code structure as geography.
- Use deterministic projection and persisted Map Sidecars so existing places keep stable coordinates.
- Use geohash prefixes as the common spine for map levels, tiles, addresses, selections, named places, and activity.
- Make package, domain, feature, and activity boundaries visible, searchable, and linkable.
- Preserve enough source context that navigation can move from map region to concrete code.
- Keep activity telemetry best-effort and separate from stable map geography.

## Agent Rules

- When design decisions are unclear, use the `grill-me` skill: ask one question at a time and include a recommended answer.
- For spatial indexing, geohashing, map navigation, or codebase-as-map work, use the `geohash-spatial-code-maps` skill.
- Prefer exploring the codebase before asking questions that local context can answer.
- Read `CONTEXT-MAP.md` before larger changes, then read the relevant package context.
- Keep implementation aligned with the modernized `core` and `viewer` package boundaries.

## Current Design Baseline

- The first stable map unit is still **File**.
- The canonical new Deep Link scheme is `codecharter://`; legacy `codemap://` remains parseable input.
- The generated Map Sidecar lives at `.codecharter/codecharter.json` by default.
- Named Places live at `.codecharter/named-places.json`.
- Local issue markdown and scratch artifacts live under gitignored `.scratch/`.

## Agent skills

### Issue tracker

Issues and PRDs are tracked as gitignored local markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default mattpocock/skills triage label vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

This repo uses a multi-context domain docs layout rooted at `CONTEXT-MAP.md`. See `docs/agents/domain.md`.
