# codecharter

Turn a code repository into a deterministic, geohash-addressed 2D **city map**
with a live **agent-activity overlay** — explore the codebase spatially, drop
durable annotations, and watch where AI agents are reading/editing in real time.

This repository is the **modernized** codebase: an npm-workspaces monorepo of two
zero-runtime-dependency TypeScript (Node ≥22, ESM) packages.

## Packages

| Package | Path | What it is |
| --- | --- | --- |
| **`@codecharter/core`** | [`core/`](core/) | The engine: codemap generation, deterministic geohash addressing, resolver, tiles, selections/annotations, activity ingestion + Codex hook, and the **hardened** localhost HTTP server + the `codemap` CLI. |
| **`@codecharter/viewer`** | [`viewer/`](viewer/) | The browser SPA: a decomposed, pure render model (`viewer/src/main/render/`), the deep-link hash-route codec, and the canvas app shell, bundled with esbuild. |

## Quick start

```sh
npm install              # installs both workspaces
npm run typecheck        # tsc across core + viewer
npm test                 # core golden test (see "Tests" below)
npm run build            # bundle the viewer to viewer/dist
npm run generate         # generate .codecharter/codecharter.json for this repo
npm run serve            # start the localhost server (serves the viewer + API)
```

The CLI is `core/bin/codemap.mts` (commands: `generate`, `resolve`, `serve`,
`dev`, `doctor`, `init`); run it via `npm run codecharter -- <command>`.

## Tests

This repo ships `core`'s self-contained golden test (`core/src/test/geohash.test.ts`).
The **full equivalence proof** — ~253 differential tests that pin every module
byte-for-byte against the original legacy implementation, plus the Playwright
DOM + canvas **pixel-diff** parity suite for the viewer — lives in the
**modernization workspace** (`../codercharter-modern`), which retains the legacy
sources for comparison. See `core/TRANSFORMATION_NOTES.md` and
`viewer/TRANSFORMATION_NOTES.md`.

## How it was built

This codebase was produced by a legacy-modernization workflow. The discovery,
business-rules, target-architecture, and security-hardening artifacts
(`ASSESSMENT.md`, `TOPOLOGY.html`, `BUSINESS_RULES.md`, `DATA_OBJECTS.md`,
`MODERNIZATION_BRIEF.md`, `SECURITY_FINDINGS.md` + `security_remediation.patch`)
live in the modernization workspace `../codercharter-modern/analysis/`, together
with the full equivalence/pixel-diff test harness. They are not tracked in this
repository.

The pre-modernization code is preserved on the `pre-modernization` git tag.
