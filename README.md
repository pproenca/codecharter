# CodeCharter

Turn a code repository into a deterministic, geohash-addressed **Code Map** with
a live Activity Stream. Explore the codebase spatially, save durable
annotations, and watch where AI agents are reading, editing, testing, and
reviewing.

This repository is a Node >=22, ESM, npm-workspaces monorepo with a core engine
package and a browser viewer package.

## Packages

| Package | Path | What it is |
| --- | --- | --- |
| **`@codecharter/core`** | [`core/`](core/) | Map Sidecar generation, deterministic geohash addressing, address resolution, tiles, selections, Named Places, activity ingestion, Codex hook support, the hardened localhost HTTP server, and CLI wiring. |
| **`@codecharter/viewer`** | [`viewer/`](viewer/) | The browser viewer: canvas app shell, Browser Hash Routes, render model (`viewer/src/main/render/`), source inspection, activity visuals, and Discovery Fog. |

## Quick start

```sh
npm install              # installs both workspaces
npm run typecheck        # tsc across core + viewer
npm test                 # root smoke test plus workspace test suites
npm run build            # build the publishable dist/ package
npm run generate         # generate .codecharter/codecharter.json for this repo
npm run serve            # start the localhost server (serves the viewer + API)
```

The CLI is `core/bin/codemap.mts` (commands: `generate`, `resolve`, `serve`,
`dev`, `doctor`, `init`). Run it locally via
`npm run codecharter -- <command>`.

## Tests

Run `npm test` for the root smoke test and the core and viewer suites. Use
workspace scripts for narrower checks:

```sh
npm run test --workspace @codecharter/core
npm run test --workspace @codecharter/viewer
npm run build --workspace @codecharter/viewer
```
