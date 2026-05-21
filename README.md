# CodeCharter

CodeCharter turns a repository into a deterministic 2D Code Map. Files and folders become stable geography, geohashes become map addresses, and agent activity is shown as a live overlay.

## Setup

```sh
npx codecharter setup --dev
```

`setup --dev` is the first-run path. It writes CodeCharter artifacts under `.codecharter/`, adds `.codecharter/` plus legacy root sidecar names to `.gitignore`, safely installs or merges local Git hooks that refresh the map after branch/merge/rewrite events, installs or merges a repo-local Codex lifecycle hook adapter under `.codex/`, starts the CodeCharter web app, and prints the exact local viewer URL.

Pass `--open` if you want the command to ask your OS to open the viewer:

```sh
npx codecharter setup --dev --open
```

The Codex adapter is zero-token and daemon-free: Codex invokes the hook, the hook delegates to `codecharter codex-hook`, and one JSONL event is appended to `.codecharter/activity.jsonl`. CodeCharter preserves existing `.codex/hooks.json` entries when it adds its own hook. Open `/hooks` in Codex to review and trust the repo-local hook.

If you only want to prepare files and hooks without starting the viewer:

```sh
npx codecharter init
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
The running command always prints `Open CodeCharter: http://127.0.0.1:<port>` so the viewer URL is unambiguous.
Activity telemetry is deliberately non-blocking. `codecharter dev` resolves changed paths to Map Addresses before posting activity, so the normal real-time stream does not read or write the sidecar on the server request path. If the server cannot resolve a legacy path-based activity event, code work continues and the event is dropped. Accepted real-time events live in memory first and are periodically appended to `.codecharter/activity.jsonl` as a JSONL archive, without a hard file-size check. The archive backlog is bounded in memory, so slow disk can drop old archive candidates without blocking live work.
While `codecharter dev` is running, changed code files refresh `.codecharter/codecharter.json` before activity is posted, so newly created files can receive stable Map Addresses without restarting the server.
`init` and `dev` add CodeCharter artifacts to the target repo's `.gitignore` and local `.git/info/exclude`, so telemetry does not show up as untracked work.

## Useful commands

```sh
codecharter init
codecharter dev --setup
pnpm test
codecharter resolve public/app.js 1 20
```

`codecharter init` prepares the Map Sidecar and local Activity Archive without serving the app. `codecharter dev --setup` is equivalent to initializing first and then starting the viewer. `resolve` is the stable interface for turning paths, line ranges, and optional column ranges into geohash-backed Map Addresses.

To map another repository from this checkout:

```sh
codecharter dev --root /path/to/project
```

The target project does not need its own `public/` directory; CodeCharter serves its bundled UI while reading source, sidecar, names, and activity archive from the target root.
