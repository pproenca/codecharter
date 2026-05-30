---
name: run-browser
description: >-
  Launch and drive the CodeCharter viewer in a real browser via agent-browser
  (a plain CLI, no MCP) to test UI changes, debug UI issues, and measure
  performance. Use when asked to run/launch/serve the viewer, screenshot or
  visually test the map UI, reproduce or debug a viewer bug (console errors, DOM
  state, network), or profile viewer performance (Core Web Vitals, load timing).
  Triggers: "run the viewer", "screenshot the map", "test this UI change",
  "why is the viewer blank", "debug the canvas", "is the viewer slow".
allowed-tools: Bash(agent-browser:*), Bash(pnpm:*), Bash(curl:*), Read
---

# run-browser

Drive the CodeCharter **viewer** (the canvas SPA in `viewer/`, served by the
core localhost server) from the command line. Following the philosophy in
[Mario Zechner's "What if you don't need MCP?"](https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/) —
a tiny browser CLI an agent scripts from bash beats a 13k-token MCP server —
the driver here is **`agent-browser`** (CDP over a real Chromium; the repo
already ships its skill at `.agents/skills/agent-browser/`). You launch the
viewer with `pnpm serve`, then `open`/`screenshot`/`eval`/`vitals` against it.

Paths below are relative to the **repo root**.

## Prerequisites

- Node >= 22 and pnpm (the repo pins `pnpm@11.2.2`).
- `agent-browser` on PATH: `npm i -g agent-browser && agent-browser install`
  (already present in this environment). For its full command reference:
  `agent-browser skills get core --full`.

## Build

```sh
pnpm install                 # once
pnpm generate                # writes .codecharter/codecharter.json (serve does NOT regenerate)
```

`serve` renders an existing Map Sidecar, so generate it first (the harness does
this automatically if it's missing).

## Run (agent path) — one-shot smoke

The committed harness launches the viewer, screenshots it, checks for console
errors, prints Core Web Vitals, and tears everything down. Exits non-zero on a
console error.

```sh
.claude/skills/run-browser/smoke.sh            # port 4173, output -> .scratch/run-browser/
.claude/skills/run-browser/smoke.sh 4180 /tmp/shots
```

Verified output: `screenshot -> .scratch/run-browser/initial.png`,
`console errors: 0`, and a vitals block (`TTFB`/`LCP`/`CLS`/`FCP`).

## Drive it yourself

Launch the viewer in the background, then script `agent-browser`:

```sh
pnpm serve &                                   # http://127.0.0.1:4173
agent-browser open "http://127.0.0.1:4173/"
agent-browser wait --load networkidle
```

**Test a UI change** (screenshot + interact + verify). Map items are drawn on a
`<canvas>`, so click by coordinate with `mouse`, not by ref; verify via the DOM
readout:

```sh
agent-browser screenshot "$PWD/.scratch/run-browser/before.png"   # MUST be absolute
agent-browser click "#selectTool"
agent-browser mouse move 480 197 && agent-browser mouse down && agent-browser mouse up
agent-browser eval "document.querySelector('main')?.textContent.match(/file:[^|]+\\|[^|]+/)?.[0]?.trim()"
#   -> "file: core/CONTEXT.md | ehbndz0jzcrj"   (path + stable geohash address)
```

**Debug a UI issue** — console errors, the accessibility/DOM tree, runtime state,
and what the page fetched:

```sh
agent-browser console --json                   # {"data":{"messages":[...]}} — error entries here = real bugs
agent-browser snapshot -i -c                    # interactive elements (toolbar buttons, toggles, forms)
agent-browser eval "({title: document.title, canvas: !!document.querySelector('canvas')})"
agent-browser network requests                  # every /api/* + asset request with status (look for non-200)
```

**Measure performance:**

```sh
agent-browser vitals --json                     # Core Web Vitals: TTFB / LCP / CLS / FCP
agent-browser eval "(() => { const n = performance.getEntriesByType('navigation')[0]; const p = performance.getEntriesByType('paint'); return { domContentLoaded: Math.round(n.domContentLoadedEventEnd), loadComplete: Math.round(n.loadEventEnd), firstPaint: Math.round(p.find(e=>e.name==='first-paint')?.startTime ?? 0), transferKB: Math.round((n.transferSize??0)/1024) }; })()"
agent-browser network har start /tmp/viewer.har # full HAR capture for deeper analysis; `har stop` to flush
```

Tear down when done:

```sh
agent-browser close --all
pkill -f "codecharter.mts serve"
```

## Run (human path)

`pnpm serve` then open `http://127.0.0.1:4173/` in a browser. Useless headless —
use the agent path above. (`pnpm codecharter -- dev --open` additionally
regenerates the map and streams live activity while you work.)

## Gotchas

- **`agent-browser screenshot` honors only ABSOLUTE paths.** A relative path
  (e.g. `.scratch/x.png`) is silently saved to `~/.agent-browser/tmp/screenshots/`
  instead. Pass `"$PWD/..."`. (The harness absolutizes for you.)
- **Map items are canvas-drawn, not DOM.** `snapshot`/`click @ref` only see the
  toolbar/controls (`#selectTool`, `#showActivity`, …). To hit a folder/file,
  `mouse move <x> <y>` + `down`/`up`, then read the `<main>` status text via
  `eval`/`get text` to confirm what got selected.
- **App state is not on `window`.** There's no `window.__cc`; inspect via the DOM
  (`document.querySelector('main').textContent`) or the canvas, not internals.
- **`serve` does not regenerate** the Map Sidecar. If the map is stale or missing,
  run `pnpm generate` (or use `dev`). A blank/empty map usually means this.
- **`vitals` reports "no React hydration data"** — expected. The viewer is a
  canvas SPA, not React; the TTFB/LCP/CLS/FCP numbers above it are still valid.
- **A blank screenshot = failed launch.** Re-check `console --json` and the serve
  log (`/tmp/run-browser-serve.log` from the harness).

## Troubleshooting

- `server never came up` → the map sidecar is likely missing; run `pnpm generate`,
  or read `/tmp/run-browser-serve.log`.
- `agent-browser: command not found` → `npm i -g agent-browser && agent-browser install`.
- Stale browser session / odd state → `agent-browser close --all` and reopen.
