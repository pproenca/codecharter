# Codemaps

Codemaps turns a repository into a deterministic 2D Code Map. Files and folders become stable geography, geohashes become map addresses, and agent activity is shown as a live overlay.

## One-command dev

```sh
npm run dev
```

That command:

- regenerates `codemap.json` from gitignore-filtered code files while preserving existing stable coordinates when possible
- serves the bundled Codemaps web app at `http://127.0.0.1:4173`
- starts a best-effort Activity Producer that watches local git changes and streams file or line-range positions to the in-memory `/api/activity` feed

Activity telemetry is deliberately non-blocking. If the server cannot resolve an activity event, code work continues and the event is dropped. Accepted real-time events live in memory first and are periodically appended to `.scratch/activity-stream.jsonl` as a JSONL archive, without a hard file-size check. The archive backlog is bounded in memory, so slow disk can drop old archive candidates without blocking live work.
While `npm run dev` is running, changed code files refresh `codemap.json` before activity is posted, so newly created files can receive stable Map Addresses without restarting the server.
`setup` and `dev` add Codemaps scratch files to the target repo's local `.git/info/exclude`, so telemetry does not show up as untracked work.

## Useful commands

```sh
npm run setup
npm run test
node ./bin/codemap.mjs resolve public/app.js 1 20
```

`npm run setup` prepares the Map Sidecar and local Activity Archive without serving the app. `resolve` is the stable interface for turning paths and line ranges into geohash-backed Map Addresses.

To map another repository from this checkout:

```sh
node ./bin/codemap.mjs dev --root /path/to/project
```

The target project does not need its own `public/` directory; Codemaps serves its bundled UI while reading source, sidecar, names, and activity archive from the target root.
