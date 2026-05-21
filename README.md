# Codemaps

Codemaps turns a repository into a deterministic 2D Code Map. Files and folders become stable geography, geohashes become map addresses, and agent activity is shown as a live overlay.

## One-command dev

```sh
pnpm dev
```

That command:

- regenerates `codemap.json` from gitignore-filtered code files while preserving existing stable coordinates when possible
- serves the bundled Codemaps web app at `http://127.0.0.1:4173`
- starts a best-effort Activity Producer that watches local git changes and streams file or line-range positions to the in-memory `/api/activity` feed

If `4173` is already in use, Codemaps automatically binds the next available local port and points the Activity Producer at that actual server.
Activity telemetry is deliberately non-blocking. `codemap dev` resolves changed paths to Map Addresses before posting activity, so the normal real-time stream does not read or write the sidecar on the server request path. If the server cannot resolve a legacy path-based activity event, code work continues and the event is dropped. Accepted real-time events live in memory first and are periodically appended to `.scratch/activity-stream.jsonl` as a JSONL archive, without a hard file-size check. The archive backlog is bounded in memory, so slow disk can drop old archive candidates without blocking live work.
While `pnpm dev` is running, changed code files refresh `codemap.json` before activity is posted, so newly created files can receive stable Map Addresses without restarting the server.
`setup` and `dev` add Codemaps scratch files to the target repo's local `.git/info/exclude`, so telemetry does not show up as untracked work.

## Useful commands

```sh
pnpm setup
pnpm test
node ./bin/codemap.mjs resolve public/app.js 1 20
```

`pnpm setup` prepares the Map Sidecar and local Activity Archive without serving the app. `resolve` is the stable interface for turning paths, line ranges, and optional column ranges into geohash-backed Map Addresses.

To map another repository from this checkout:

```sh
node ./bin/codemap.mjs dev --root /path/to/project
```

The target project does not need its own `public/` directory; Codemaps serves its bundled UI while reading source, sidecar, names, and activity archive from the target root.
