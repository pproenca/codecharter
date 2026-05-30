---
name: codecharter-testing
description: Choose, run, rerun, or debug CodeCharter tests and validation with the smallest proof that covers the touched map, core, viewer, CLI, or docs surface.
---

# CodeCharter Testing

Use this skill when deciding what to test, debugging failures, or validating a
CodeCharter change without over-running the local machine.

## Read First

- `AGENTS.md` for repo-wide commands and validation policy.
- `CONTEXT-MAP.md` to route the touched path to the right package context.
- `core/CONTEXT.md` for core engine, CLI, server, resolver, generation,
  selections, Named Places, or activity changes.
- `viewer/CONTEXT.md` for browser, render-model, route, source-panel, activity
  visual, or discovery-fog changes.
- Relevant ADRs in `docs/adr/` when stable addresses, sidecar shape, geohash
  levels, Deep Links, or telemetry contracts are touched.

## Default Rule

Prove the touched surface first. Do not reflexively run the whole suite.

1. Inspect the diff and classify the changed surface.
2. Reproduce narrowly before fixing when there is a reported failure.
3. Fix the root cause.
4. Rerun the same narrow proof.
5. Broaden only when the touched contract demands it.

## Proof Routing

- Docs-only: `git diff --check`.
- Root package or CLI smoke: `node --test test/*.test.mjs`, or the specific
  root test file.
- Core behavior: `./node_modules/.bin/tsx --test core/src/test/<file>.test.ts`
  for a focused file, or `pnpm --filter @codecharter/core test` for the core
  package suite.
- Viewer render-model behavior:
  `./node_modules/.bin/tsx --test viewer/src/test/<file>.test.ts` for a focused
  file, or `pnpm --filter @codecharter/viewer test` for the viewer package
  suite.
- Cross-package contracts, package output, build script, CLI/server bundle, or
  public package layout: `pnpm build`, then the relevant smoke or package
  test.
- Visual or interactive viewer changes: `pnpm build`, start the local server
  if needed, and inspect in a browser.
- Stable geography, sidecar schema, geohash levels, or Deep Link compatibility:
  focused tests first, then `pnpm test`.

## Command Semantics

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm generate
pnpm serve
pnpm codecharter -- resolve <target>
```

- `pnpm typecheck` runs `tsgo` across core and viewer.
- `pnpm lint` runs `oxlint`.
- `pnpm format:check` runs `oxfmt --check`.
- `pnpm test` runs root Node tests and workspace tests.
- `pnpm build` proves bundled CLI and viewer package output.
- `pnpm generate` rewrites the local Map Sidecar for this repo.
- `pnpm serve` starts the localhost viewer/API.

## Guardrails

- Do not update fixtures, generated sidecars, or expected output just to silence
  failures. Decide whether the Map Sidecar, Deep Link, or package contract
  changed.
- Do not depend on local `.codecharter/` or `.scratch/` state in tests unless
  the test creates and owns a temporary workspace.
- Do not make telemetry failures fatal unless the contract being tested is
  explicitly about validation or server response behavior.
- If dependencies are missing, run `pnpm install`, retry once, then report the
  first actionable error.

## Output Habit

Report:

- touched surface
- exact command run
- result
- any broader proof intentionally skipped and why
