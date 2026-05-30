# CodeCharter

**Turn a code repository into a deterministic, geohash-addressed map you can pan,
zoom, search, annotate, and watch while AI agents work.**

Large codebases are places. You build spatial memory around packages, domains,
files, and hotspots — but every file-tree walk throws that memory away.
CodeCharter makes it durable: it projects a repository onto a 2D **Code Map**,
gives every folder, file, and line span a stable geohash **Map Address**, and
serves that map in a local browser viewer. Because addresses survive
regeneration, humans and agents can point at the _same_ place with a portable
`codecharter://` link — and a best-effort activity overlay shows where agents are
reading, editing, testing, and reviewing in real time.

## Highlights

- **Deterministic Code Map.** Folders and files are laid out into a unit-square
  Code Plane and addressed by geohash. Identical input produces a byte-identical
  map, and existing places stay put across regeneration while the projection
  contract matches.
- **Browser viewer.** Pan, zoom, and search the map; draw selections; save Named
  Places; and inspect real source text inline as you zoom into a file.
- **Durable addresses + Deep Links.** Every place has a `codecharter://` URI.
  The `resolve` command turns a path or link into a Map Address (and back), so
  tools, docs, and agents share one vocabulary for "where."
- **Live activity overlay.** A dev watcher (and optional Codex hooks) stream
  best-effort activity events; the viewer renders them as trails and
  Age-of-Empires-style **Discovery Fog** (`unexplored` → `explored` → `visible`).
  Telemetry never blocks code work.
- **Hardened, local-first server.** The API binds to `127.0.0.1` with a loopback
  Host allowlist, request body limits, map schema validation, and source
  path containment.
- **Hackable.** TypeScript ESM, no runtime dependencies, builds with esbuild.

## Requirements

- **Node.js >= 22**
- **pnpm** (the repo pins `pnpm@11.2.2` via `packageManager`)

## Quick start

```sh
git clone https://github.com/pproenca/codecharter.git
cd codecharter
pnpm install          # install both workspaces
pnpm build            # build the publishable CLI into dist/
```

Map this repository and open the live viewer in one command:

```sh
pnpm codecharter -- dev --open
```

`dev` generates the Map Sidecar, serves the viewer + API on
`http://127.0.0.1:4173`, and watches `git` so activity shows up as you work.
Point it at any other checkout with `--root <dir>`.

Prefer the steps separately:

```sh
pnpm generate         # write .codecharter/codecharter.json for this repo
pnpm serve            # serve the viewer + API at http://127.0.0.1:4173
```

`pnpm codecharter -- <command>` runs the CLI from source; after `pnpm build` the
same CLI is available as the `codecharter` (and `map`) binary.

## Typical workflow

1. **Set up a repo once** — `codecharter init` writes `.codecharter/` config and
   optionally installs Codex activity hooks and local git hooks that refresh the
   map. (`codecharter setup` does the same non-interactively and starts `dev`.)
2. **Explore** — run `dev` (or `serve`) and open the viewer. Pan/zoom to a file,
   inspect its source, draw a selection, and save it as a Named Place.
3. **Share a location** — copy a `codecharter://` Deep Link from the viewer, or
   generate one from the CLI:

   ```sh
   pnpm codecharter -- resolve core/src/main/geohash.ts 1 20
   pnpm codecharter -- resolve "codecharter://file/<locator>" --json
   ```

4. **Watch agents** — with activity enabled, the map shows live trails and
   Discovery Fog over the regions agents are touching.

## CLI commands

Run via `pnpm codecharter -- <command>` from the repo, or as `codecharter
<command>` once built/installed. Every command accepts `--root <dir>` (default:
the current directory).

| Command                      | What it does                                                                                                                                | Common flags                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `init` / `setup`             | Create `.codecharter/` config and optionally install Codex activity hooks + local git hooks. `setup` is non-interactive and launches `dev`. | `--yes`, `--no-codex`, `--no-git-hooks`, `--dev`, `--open`                   |
| `dev`                        | Generate the map, serve the viewer + API, and watch `git` to stream activity.                                                               | `--port <n>` (default `4173`), `--open`, `--fresh`, `--no-watch`, `--setup`  |
| `generate`                   | Write/refresh the Map Sidecar at `.codecharter/codecharter.json`.                                                                           | `--out <file>`, `--fresh`, `--quiet`                                         |
| `serve`                      | Serve the viewer + hardened localhost API over an existing Map Sidecar (no regeneration, no watcher).                                       | `--map <file>`, `--port <n>`, `--open`                                       |
| `resolve`                    | Resolve a path (with optional line range) or a `codecharter://` Deep Link to a Map Address.                                                 | `--json`, `--map <file>`, `--server <url>`, `--column-start`, `--column-end` |
| `annotation` / `annotations` | Read one annotation, or list saved annotations.                                                                                             | `--json`, `--server <url>`, `--limit <n>`                                    |
| `clear`                      | Clear the activity history.                                                                                                                 | `--json`, `--server <url>`, `--out <file.jsonl>`                             |
| `doctor`                     | Diagnose the setup (root, map file, optional server).                                                                                       | `--json`, `--map <file>`, `--server <url>`                                   |
| `--version`, `--help`        | Print the version or usage.                                                                                                                 |                                                                              |

Add `--json` to any read command for machine-readable output. For automation,
`resolve` is the stable surface; humans use `init`, `dev`, and `clear`.

## Concepts

- **Code Map** — the navigable spatial representation of a repository. The
  **Code Plane** is the normalized unit square it's laid out on.
- **Map Sidecar** (`.codecharter/codecharter.json`) — the canonical record of
  stable base geography: folders, files, bounds, geohash coordinates, Map
  Levels, and projection metadata. Volatile overlays are kept out of it.
- **Map Address & geohash** — geohash prefixes are the addressing spine. A **Map
  Level** maps a scale to a precision: `world`, `region`, `folder`, `file`,
  `code`, `lineRange`, `tokenRange`.
- **Deep Link** — the portable URI form of a Map Address,
  `codecharter://<kind>/<locator>?...` (legacy `codemap://` still parses as
  input).
- **Named Places & Drawn Selections** — saved places in
  `.codecharter/named-places.json`: drawn selections, map annotations, and named
  addresses.
- **Activity & Discovery Fog** — agent activity is a best-effort overlay, never
  persisted into the Map Sidecar. The viewer derives fog state
  (`unexplored`/`explored`/`visible`) from the activity stream.

See [`VISION.md`](VISION.md) for the product direction and [`CONTEXT.md`](CONTEXT.md)
for the full domain vocabulary.

## Repository layout

A Node >= 22, ESM, pnpm-workspaces monorepo:

| Package                   | Path                 | What it is                                                                                                                                                                                                                           |
| ------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`@codecharter/core`**   | [`core/`](core/)     | Map Sidecar generation, deterministic geohash addressing, address resolution, tiles, selections, Named Places, activity ingestion, Codex hook support, the hardened localhost HTTP server, and the CLI (`core/bin/codecharter.mts`). |
| **`@codecharter/viewer`** | [`viewer/`](viewer/) | The browser viewer: canvas app shell, Browser Hash Routes, render model, source inspection, activity visuals, and Discovery Fog.                                                                                                     |

`pnpm build` produces the publishable `dist/` package (the `codecharter` /
`map` CLI plus the bundled viewer).

## Development

```sh
pnpm typecheck                          # tsgo across core + viewer
pnpm lint                               # oxlint
pnpm format                             # oxfmt (use format:check in CI)
pnpm test                               # root smoke test + workspace suites
pnpm check                              # format:check + lint + typecheck + test
```

Narrower checks per workspace:

```sh
pnpm --filter @codecharter/core test
pnpm --filter @codecharter/viewer test
pnpm --filter @codecharter/viewer build
```

Formatting is `oxfmt` (not Prettier), linting is `oxlint`, and typechecking is
`tsgo` — repo defaults; don't swap the toolchain without discussion.

## Security

CodeCharter is local-first but explicit about trust boundaries: the server reads
source files and serves map data, so it binds to `127.0.0.1`, enforces a
loopback Host allowlist, caps request bodies, validates the map schema, and
contains source-file reads within the project root. Treat the localhost routes
and file reads as security-sensitive when changing them.

## Documentation

- [`VISION.md`](VISION.md) — product direction and roadmap guardrails.
- [`CONTEXT.md`](CONTEXT.md) — domain language and architectural vocabulary.
- [`docs/PRINCIPLES.md`](docs/PRINCIPLES.md) — the invariants behind every design decision.
- [`docs/adr/`](docs/adr/) — architecture decision records.
- [`AGENTS.md`](AGENTS.md) — guidance for working in this repository.
