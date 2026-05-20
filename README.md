# Codemaps

Codemaps turns a repository into a deterministic 2D Code Map. Files and folders become stable geography, geohashes become map addresses, and agent activity is shown as a live overlay.

## One-command dev

```sh
npm run dev
```

That command:

- regenerates `codemap.json` from gitignore-filtered code files while preserving existing stable coordinates when possible
- serves the map at `http://127.0.0.1:4173`
- starts a best-effort Activity Producer that watches local git changes and streams file or line-range positions to `/api/activity`

Activity telemetry is deliberately non-blocking. If the server cannot resolve or persist an activity event, code work continues and the event is dropped.
While `npm run dev` is running, changed code files refresh `codemap.json` before activity is posted, so newly created files can receive stable Map Addresses without restarting the server.

## Useful commands

```sh
npm run setup
npm run test
node ./bin/codemap.mjs resolve public/app.js 1 20
```

`npm run setup` prepares the Map Sidecar and Activity Stream without serving the app. `resolve` is the stable interface for turning paths and line ranges into geohash-backed Map Addresses.
