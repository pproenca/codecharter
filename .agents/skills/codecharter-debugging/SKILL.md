---
name: codecharter-debugging
description: Debug CodeCharter map generation, stable addresses, resolver output, localhost server behavior, viewer rendering, activity telemetry, or package output by choosing the narrowest signal before changing code.
---

# CodeCharter Debugging

Use this skill when CodeCharter behavior differs from expected map, CLI, server,
viewer, or telemetry behavior and the next move should be a debug signal rather
than a guess.

## Read First

- `CONTEXT-MAP.md` and the relevant package context.
- ADRs for the contract involved:
  - stable addresses: `docs/adr/0001-stable-code-map-addresses.md`
  - sidecar shape: `docs/adr/0002-json-map-sidecar.md`
  - geohash levels: `docs/adr/0003-geohash-map-levels.md`
  - Deep Links: `docs/adr/0004-codemap-deep-links.md`
  - activity telemetry: `docs/adr/0005-non-blocking-activity-telemetry.md`
- Use `codecharter-testing` for proof selection when available.

## Default Loop

1. State the suspected boundary: scan, tree, layout, stability reuse, geohash,
   resolver, selection overlap, sidecar store, server route, activity producer,
   viewer route, render model, or package bundle.
2. Add or run the narrowest signal that proves that boundary.
3. Compare current generated data with the expected contract.
4. Patch the root cause.
5. Rerun the failing probe, then broaden only when the contract requires it.

## Common Probes

```bash
pnpm codecharter -- generate
pnpm codecharter -- resolve <path-or-link>
pnpm codecharter -- --json resolve <path-or-link>
pnpm codecharter -- doctor
pnpm build
pnpm test
```

- Use JSON resolve output to inspect geohash, bounds, breadcrumbs, level, range,
  and Deep Link data.
- Use generated `.codecharter/codecharter.json` only as map data; do not treat
  activity or discovery state as base geography.
- For server bugs, inspect `core/src/main/server.ts` and preserve host, body,
  validation, and path-containment checks.
- For viewer bugs, isolate whether route parsing, target reconciliation,
  camera transforms, LOD, fog, activity, or source-panel formatting is wrong.

## Boundary Hints

- A path is missing: check scan inclusion, gitignore filtering, extension
  filtering, and generated sidecar contents before changing resolver logic.
- A link is unstable: check Projection Contract and stability reuse before
  changing geohash encoding.
- A selected area resolves oddly: check Drawn Selection geometry, Covering Set,
  overlap refinement, and current Map Sidecar targets.
- Activity is absent: check producer setup and resolver output, but remember
  telemetry is best-effort.
- Viewer target is wrong: compare browser hash route with `codecharter://` Deep
  Link and core resolve output.
- Package behavior differs from source: run `pnpm build` and inspect `dist/`.

## Output Habit

Report:

- boundary tested
- exact command or source probe
- observed signal
- fix location
- narrow proof and remaining risk
