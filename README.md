# CodeCharter

CodeCharter turns a repository into a deterministic 2D Code Map. Files and folders become stable geography, geohashes become map addresses, and agent activity is shown as a live overlay.

## Setup

```sh
npx --yes codecharter@latest setup
```

`setup` is the first-run path. It writes CodeCharter artifacts under `.codecharter/`, adds `.codecharter/` plus legacy root sidecar names to `.gitignore`, safely installs or merges local Git hooks that refresh the map after branch/merge/rewrite events, installs a repo-local CodeCharter skill under `.agents/skills/codecharter/`, installs or merges a repo-local Codex lifecycle hook adapter under `.codex/`, starts the CodeCharter web app, and prints the exact local viewer URL.

Pass `--open` if you want the command to ask your OS to open the viewer:

```sh
npx --yes codecharter@latest setup --open
```

The Codex adapter is zero-token and daemon-free: Codex invokes the hook, the hook delegates to `codecharter codex-hook`, and one JSONL event is appended to `.codecharter/activity.jsonl`. CodeCharter preserves existing `.codex/hooks.json` entries when it adds its own hook. The installed skill teaches Codex how to interpret CodeCharter annotation prompts, local viewer URLs, and corner geohashes without bulk-reading every mapped target. Open `/hooks` in Codex to review and trust the repo-local hook.

Codex can resolve annotation prompts without browser automation:

```sh
codecharter --json doctor
npx --yes codecharter@latest --json doctor
codecharter --json annotation 'http://127.0.0.1:4173/#/annotation/<id>'
codecharter --json annotation codecharter://annotation/<id>
npx --yes codecharter@latest --json annotation codecharter://annotation/<id>
codecharter --json source src/app.ts 1 80
```

The agent contract is CLI-first. `doctor` prints setup, auth, map, hook, skill, package-version, command fallback, and optional server reachability diagnostics. Under `--json`, `annotation` prints a stable JSON object with the refreshed annotation, `resolvedTargets`, and `targetCount`. Without `--json`, read commands print terse line-oriented output for humans. If the URL includes a local server origin, CodeCharter reads `/api/annotations/<id>`; otherwise it falls back to `.codecharter/named-places.json` and `.codecharter/codecharter.json`. `source` reads a bounded file range from the map. `api` is a read-only raw escape hatch for local `/api/...` endpoints. Copied annotation prompts include the exact `codecharter --json annotation ...` command and an `npx --yes codecharter --json ...` fallback, so Codex does not need browser automation for normal annotation work.

JSON policy: read commands print stable JSON objects only under `--json`; otherwise they print terse line-oriented output. Errors under `--json` use `{ "ok": false, "error": { "message": "..." } }`. CodeCharter does not require auth; `doctor` reports `auth.required: false`.

If you only want to prepare files and hooks without starting the viewer:

```sh
npx --yes codecharter@latest init
```

## One-command dev

```sh
codecharter dev
```

That command:

- regenerates `.codecharter/codecharter.json` from gitignore-filtered code files while preserving existing stable coordinates when possible
- serves the bundled CodeCharter web app at `http://127.0.0.1:4173`
- starts a best-effort Activity Producer that watches local git changes and streams file or line-range positions to the in-memory `/api/activity` feed

If `4173` is already in use, CodeCharter automatically binds the next available local port and points the Activity Producer at that actual server.
The running command always prints `viewer: http://127.0.0.1:<port>` so the viewer URL is unambiguous.
Activity telemetry is deliberately non-blocking. `codecharter dev` resolves changed paths to Map Addresses before posting activity, so the normal real-time stream does not read or write the sidecar on the server request path. If the server cannot resolve a legacy path-based activity event, code work continues and the event is dropped. Accepted real-time events live in memory first and are periodically appended to `.codecharter/activity.jsonl` as a JSONL archive, without a hard file-size check. The archive backlog is bounded in memory, so slow disk can drop old archive candidates without blocking live work.
While `codecharter dev` is running, changed code files refresh `.codecharter/codecharter.json` before activity is posted, so newly created files can receive stable Map Addresses without restarting the server.
`init` and `dev` add CodeCharter artifacts to the target repo's `.gitignore` and local `.git/info/exclude`, so telemetry does not show up as untracked work.

Human output follows a stable line-oriented pattern:

```text
setup: ok
map: .codecharter/codecharter.json
files: 18
folders: 7
viewer: http://127.0.0.1:4173
next: /hooks
```

## Commands

```sh
npx --yes codecharter@latest setup
codecharter init
codecharter dev
codecharter --json doctor
codecharter --json annotation codecharter://annotation/<id>
codecharter --json source public/app.js 1 20
```

`setup` is the opinionated first-run command. `init` prepares the Map Sidecar and local Activity Archive without serving the app. `dev` starts the viewer for an already prepared repo. `annotation` is the agent-safe read path for turning a pasted CodeCharter annotation prompt into JSON. `source` reads bounded source ranges.

Advanced commands are still available when needed: `annotations` lists saved annotations, `resolve` turns paths and ranges into geohash-backed Map Addresses, `api` performs read-only GETs against local CodeCharter API endpoints, and `activity` appends explicit local activity events.

To map another repository from this checkout:

```sh
codecharter dev --root /path/to/project
```

The target project does not need its own `public/` directory; CodeCharter serves its bundled UI while reading source, sidecar, names, and activity archive from the target root.
