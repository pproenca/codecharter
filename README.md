# CodeCharter

Codebase maps that agents and humans can navigate.

`codecharter` turns a repo into a deterministic 2D map. Files and folders become stable geography, geohash prefixes become map addresses, and local agent activity can be shown as a live overlay.

Current status: early CLI and local web viewer. Setup, map generation, stable address resolution, annotation lookup, Codex hooks, and activity telemetry are implemented. The map starts from files and folders today; deeper symbol and domain-object projection are future layers.

## Install

```sh
pnpm add -g codecharter
```

One-shot usage without installing globally:

```sh
npx --yes codecharter@latest setup
```

From source:

```sh
pnpm install
pnpm link --global
```

CodeCharter requires Node.js 22 or newer.

## Workflow

```sh
codecharter setup
codecharter dev
codecharter --json doctor
codecharter --json annotation codecharter://annotation/<id>
codecharter annotations --json --limit 10
codecharter resolve src/index.js 1 40 --json
codecharter activity clear
```

`setup` is the opinionated first-run command. It prepares `.codecharter/`, installs or merges local Git hooks, installs or merges the repo-local Codex hook adapter under `.codex/`, installs the CodeCharter Codex skill, starts the viewer, and prints the local viewer URL.

`dev` regenerates the map, serves the bundled viewer, and starts a best-effort activity producer that watches local Git changes and streams map positions to the in-memory activity feed.

## What It Maps Today

- gitignore-filtered files in the target repository
- folder regions derived from the filesystem tree
- deterministic file and folder coordinates
- stable geohash-backed Map Addresses
- map levels from world to line-range precision
- named annotations and drawn selections from the local viewer
- local activity events from Codex hooks and file changes
- target repos outside this checkout through `--root <dir>`

The first stable unit is the file. Files are easy to extract, stable enough for the first projection, and can later expand into symbols or domain objects without changing the address model.

## Codex Integration

The default agent integration is local Codex.

```sh
codecharter setup
codecharter --json doctor
```

The installed Codex adapter is zero-token and daemon-free: Codex invokes the lifecycle hook, the hook delegates to `codecharter codex-hook`, and one JSONL event is appended to `.codecharter/activity.jsonl`.

Copied annotation prompts include the exact CLI command Codex should run:

```sh
codecharter --json annotation codecharter://annotation/<id>
npx --yes codecharter@latest --json annotation codecharter://annotation/<id>
```

Codex should use the JSON response to read only the resolved target files and line ranges with normal file-reading tools. It does not need browser automation or bulk source reads for normal annotation work.

Open `/hooks` in Codex to review and trust the repo-local hook after setup.

## Commands

- `codecharter setup`: initialize the repo, install hooks and skill files, start the viewer
- `codecharter init`: prepare map files and hooks without starting the viewer
- `codecharter dev`: regenerate the map, serve the viewer, and stream local activity
- `codecharter doctor`: check setup, CLI version, map files, hooks, skill files, and optional server reachability
- `codecharter annotation <id-or-url>`: resolve an annotation URL or `codecharter://annotation/<id>` into target files and ranges
- `codecharter annotations`: list saved annotations
- `codecharter resolve <path> [lineStart] [lineEnd]`: resolve a file or line range into a Map Address
- `codecharter activity <path> [lineStart] [lineEnd]`: append an explicit activity event
- `codecharter activity clear`: clear the local Activity Archive, and optionally the live server feed
- `codecharter api <api-path-or-url> --server <url>`: perform read-only GETs against local CodeCharter API endpoints
- `codecharter generate`: write a map JSON file
- `codecharter serve`: serve the bundled viewer for an existing map

Useful flags:

- `--root <dir>`
- `--port <port>`
- `--open`
- `--json`
- `--server <url>`
- `--map <file>`
- `--out <file>`
- `--fresh`
- `--quiet`
- `--limit <n>`
- `--agent <id>`
- `--state <state>`
- `--note <text>`

## JSON Output

Read commands print stable JSON objects only under `--json`. Without `--json`, they print terse line-oriented output for humans.

Errors under `--json` use:

```json
{
  "ok": false,
  "error": {
    "message": "..."
  }
}
```

`doctor --json` reports setup, auth, map, hook, skill, package-version, command fallback, and optional server reachability diagnostics. CodeCharter does not require auth; `doctor` reports `auth.required: false`.

`annotation --json` returns the refreshed annotation, `resolvedTargets`, and `targetCount`. If the input includes a local server origin, CodeCharter reads `/api/annotations/<id>`; otherwise it falls back to `.codecharter/named-places.json` and `.codecharter/codecharter.json`.

## State

State is project-local by default:

```text
.codecharter/
  codecharter.json
  config.json
  named-places.json
  activity.jsonl
```

`codecharter.json` is the canonical Map Sidecar. It stores the code plane, files, folders, map levels, projection metadata, and stable geohash-backed addresses.

`activity.jsonl` is the local Activity Archive. Accepted real-time events live in memory first and are periodically appended to the archive. Slow disk can drop old archive candidates without blocking live code work.

Setup also writes local integration files when needed:

```text
.agents/skills/codecharter/
.codex/hooks.json
.codex/hooks/codecharter-codex-hook.mjs
```

## Safety

- CodeCharter does not require auth.
- `setup` preserves existing `.codex/hooks.json` entries when adding its own hook.
- `init` and `dev` add CodeCharter artifacts to `.gitignore` and local `.git/info/exclude`.
- Activity telemetry is best-effort and non-blocking.
- The normal activity stream resolves paths before posting events, so server requests do not read or write the sidecar on the hot path.
- `api` is read-only and blocks raw source endpoints.
- Annotation resolution is CLI-first, so agents can inspect only the files and ranges selected by the map.
- If port `4173` is busy, the server binds the next available local port and prints the exact viewer URL.

See `CONTEXT.md` and `docs/adr/` for the product context and architecture decisions.
