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

Run `npm test` for the core and viewer suites.
