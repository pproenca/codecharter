# CodeCharter

CodeCharter turns a repository into a deterministic 2D Code Map. Files and folders become stable geography, geohashes become map addresses, and agent activity is shown as a live overlay.

## Setup

```sh
npx codecharter init
```

`init` is an interactive setup. It generates `codecharter.json`, writes `.codecharter/config.json`, adds local scratch excludes, installs local Git hooks that refresh the map after branch/merge/rewrite events, and can install a repo-local Codex lifecycle hook adapter under `.codex/`.

The Codex adapter is zero-token and daemon-free: Codex invokes the hook, the hook delegates to `codecharter codex-hook`, and one JSONL event is appended to `.scratch/codecharter/activity.jsonl`. Open `/hooks` in Codex to review and trust the repo-local hook.

## One-command dev

```sh
codecharter dev
```

That command:

- regenerates `codecharter.json` from gitignore-filtered code files while preserving existing stable coordinates when possible
- serves the bundled CodeCharter web app at `http://127.0.0.1:4173`
- starts a best-effort Activity Producer that watches local git changes and streams file or line-range positions to the in-memory `/api/activity` feed

If `4173` is already in use, CodeCharter automatically binds the next available local port and points the Activity Producer at that actual server.
Activity telemetry is deliberately non-blocking. `codecharter dev` resolves changed paths to Map Addresses before posting activity, so the normal real-time stream does not read or write the sidecar on the server request path. If the server cannot resolve a legacy path-based activity event, code work continues and the event is dropped. Accepted real-time events live in memory first and are periodically appended to `.scratch/codecharter/activity.jsonl` as a JSONL archive, without a hard file-size check. The archive backlog is bounded in memory, so slow disk can drop old archive candidates without blocking live work.
While `codecharter dev` is running, changed code files refresh `codecharter.json` before activity is posted, so newly created files can receive stable Map Addresses without restarting the server.
`init` and `dev` add CodeCharter scratch files to the target repo's local `.git/info/exclude`, so telemetry does not show up as untracked work.

## Useful commands

```sh
codecharter init
pnpm test
codecharter resolve public/app.js 1 20
```

`codecharter init` prepares the Map Sidecar and local Activity Archive without serving the app. `resolve` is the stable interface for turning paths, line ranges, and optional column ranges into geohash-backed Map Addresses.

To map another repository from this checkout:

```sh
codecharter dev --root /path/to/project
```

The target project does not need its own `public/` directory; CodeCharter serves its bundled UI while reading source, sidecar, names, and activity archive from the target root.
