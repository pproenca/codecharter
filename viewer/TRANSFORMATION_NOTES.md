# Transformation Notes — `public-src` → `@codecharter/viewer`

Phase 4 of the codecharter modernization: the browser viewer. The legacy
`public-src/` was a 3-file ES-module bundle (`deep-links.ts`, `render-model.ts`,
`app.ts`) compiled by `tsc` to `public/*.js` and served as separate native
modules. The modern package keeps the same client behavior but splits the pure
**functional core** (render model) into cohesive, individually differential-tested
modules, and bundles the **imperative shell** (`app.ts`) with esbuild.

Legacy source: `/Users/pedroproenca/Documents/Projects/codecharter/public-src`
Equivalence proof: differential tests for pure modules; a Playwright DOM-contract
+ canvas **pixel-diff** suite for the shell.

## Status

| Surface | Modern location | Proof | Result |
| --- | --- | --- | --- |
| `deep-links.ts` (BR-030) | `src/main/deep-links.ts` | differential vs legacy + core | 6 tests |
| `render-model.ts` (BR-018/019, 134 exports) | `src/main/render/*.ts` | differential vs legacy (fuzzed) | 42 tests |
| `app.ts` (2,957 LOC SPA) | `src/main/app.ts` + `web/` + `scripts/build.mjs` | Playwright DOM + canvas pixel-diff | 5 states, 0 px diff |

`tsc --noEmit` clean · `npm test` = **48** · `npm run e2e` = **5** (every state byte-identical canvas).

## Mapping table — `render-model.ts` → `render/`

The single 1,620-line module became eight cohesive modules plus a barrel that
re-publishes the **exact** legacy export set (verified by a coverage test).

| Legacy `render-model.ts` (lines) | Behavior | Modern module |
| --- | --- | --- |
| 1–24 | tuning constants (BR-018/019) | `render/constants.ts` |
| 26–188 | shared type aliases | `render/types.ts` |
| 1082–1091, 1152–1162, 893–896, 1573–1620 | clamp / sort / hash / path / bounds / palette / `actionFor` helpers | `render/primitives.ts` |
| 307–456, 207–212, 1557–1601 | detail bands, folder/file visual state, organic regions, landmarks, labels (BR-019) | `render/lod.ts` |
| 592–711, 767–798, 221–257, 656–700 | projection, zoom/pan, keyboard, interaction state | `render/camera.ts` |
| 458–564, 898–937 | fog-of-war + discovery fog styles | `render/fog.ts` |
| 1038–1219, 1234–1555 | activity decay/encoding, trails, sorting/feed, activity hit-test (BR-018) | `render/activity.ts` |
| 576–891 (source subset) | source-panel layout, line ranges, LRU cache, clipboard prompt | `render/source-panel.ts` |
| 235–305, 939–1115 | search, route lookup, hit-test (file/folder/annotation), selection panel, hover | `render/targets.ts` |
| all `export`s | public barrel mirroring the legacy surface | `render/index.ts` |

## Deliberate deviations (behavior preserved; structure changed)

1. **Decomposition only.** Every exported function is transcribed with identical
   arithmetic, ordering, rounding, and edge-case handling. The differential
   suite fuzzes each export against the legacy module (geohash-style: thousands
   of seeded cases, deterministic `now`) and a coverage test asserts the modern
   barrel exports the same runtime set with the same `typeof` and identical
   constant values.
2. **`shortActivityId` promoted to a shared export.** It was an inline private in
   legacy, reused by both `activity.ts` (`activityActorLabel`) and `targets.ts`
   (`mapHoverLabel`). It is the only function the barrel exports beyond the legacy
   set; the coverage test pins this as the sole intended extra.
3. **`primitives.ts` internals stay private.** `clamp`, `sortIfNeeded`,
   `hashUnit`, `objectValues`, `pointDistance`, path/palette helpers, and
   `actionFor` are shared across modules but **not** re-exported from the barrel
   — only the five helpers legacy exported (`rgba`, `hashString`, `boundsCenter`,
   `containsBoundsPoint`, `normalizeMapPath`) are public.
4. **`app.ts` is a faithful port, not a decomposition.** The 2,957-line shell was
   copied byte-for-byte and ONLY its two import specifiers were repointed
   (`./render-model.js` → `./render/index.ts`, `./deep-links.js` → `./deep-links.ts`)
   — the same surgical technique used for `bin/codemap.mts` in core. Rationale:
   it is the *imperative shell* (DOM + canvas + network) around the now-decomposed
   *functional core*; with a pixel-diff harness as the safety net, the
   professional sequence is faithful-port-green-first, then refactor seams. The
   shell typechecks cleanly against the new modules (proving exact surface
   compatibility) and bundles to one ES module via esbuild.
5. **`deep-links.ts` `formatRouteNumber`** was unified to `Number(v).toFixed(12)…`
   to match core's server-side codec (closed debt #3) in the earlier increment;
   the differential test pins viewer == legacy == core for valid bounds.

## What was NOT migrated / changed

- **Nothing dropped from `render-model`.** All 134 exports are preserved even
  where `app.ts` does not currently consume them (≈80 are used) — they are the
  module's public API and are individually tested.
- `LANDMARK_NAMES` and `ORGANIC_REGION_EDGES` remain module-internal (legacy kept
  them private); `LANDMARK_NAMES` lives in `constants.ts` for `lod.ts`, not in the
  barrel.
- The legacy `// Edit this source, then run pnpm build:public …` header comment
  was dropped (the viewer has its own esbuild pipeline).

## Test strategy

- **Pure modules (deep-links, render-model):** differential equivalence — import
  BOTH legacy and modern, fuzz/fixture, `assert.deepEqual` with a normalizer that
  makes `Map`/`Set`/`URLSearchParams` comparable while *preserving insertion
  order* (so an ordering divergence is caught, not just a value one). Time-dependent
  functions are always called with an explicit `now`.
- **Shell (`app.ts`):** `tests-e2e/parity.spec.ts` runs the modern bundle and the
  legacy bundle against the **same `@codecharter/core` backend** over byte-identical
  fixture data (two server instances, identical API by construction, only the
  served `publicRoot` differs — isolating the comparison to the client). `Date.now`
  is frozen per-page for deterministic activity decay; reduced-motion makes camera
  moves instant. Each state asserts a DOM contract (`#viewportReadout`,
  `#annotationTitle`) and a canvas pixel diff. Source text renders incrementally,
  so the canvas is sampled until self-stable before comparing pages. Result: **0
  diff** for initial load, LOD zoom, activity+fog overlay, source-text deep-link,
  and the seeded annotation.

## Follow-ups

1. **Physically share** the deep-link codec and the geometry/clamp/hash
   primitives between `@codecharter/core` and `@codecharter/viewer` — they are
   currently behaviorally unified (and tested as such) but duplicated.
2. **Decompose the `app.ts` shell** into renderer / router / polling /
   annotations-ui / camera modules, using the pixel-diff harness as the
   regression gate (now that it exists and is green).
3. **Extend the e2e suite** to mutating flows (annotation create/save, clear
   activity) and multi-agent trail rendering; add a couple more LOD bands and a
   pan state.
4. The e2e harness pins the legacy path absolutely (`/Users/pedroproenca/…/codecharter`)
   and serves the legacy `public/` build; make this configurable if the repos move.

## Architecture review (architecture-critic)

The render/ split was confirmed to be an acyclic DAG
(`constants → primitives → {lod, camera, activity} → {fog, source-panel, targets} → index`)
— no import cycles, which is the headline risk for this kind of decomposition.

**Applied now (HIGH + hygiene):**
- **H1** — the source-text and annotation parity tests sampled with a plain
  shot after a fixed 500 ms wait, defeating the incremental-render stability
  guard; both now use `stableCanvasShot` + `networkidle`.
- **H2** — `scripts/build.mjs` now documents the `target: es2024` coupling to the
  legacy `tsconfig.public.json` and pins `minify: false` + `charset: utf8` for a
  deterministic, reviewable emit.
- **M4** — added `.gitignore` (`dist/`, `test-results/`, `node_modules/`,
  `playwright-report/`); the bundle is reproducible and not vendored.

**Recorded / deferred (no equivalence risk; tackle with the app.ts decomposition):**
- **M1** — barrel uses `export *`; ESM silently drops a name colliding across two
  modules. The existing coverage test catches any *legacy* name vanishing
  (reports it as missing), so the public contract is guarded; converting to
  explicit per-module re-exports is a future auditability nicety.
- **M2** — `mapSelectionPanel` returns two structurally different shapes (file vs
  folder/empty); kept verbatim for equivalence. Give it an explicit
  all-optional return type when the shell is decomposed.
- **M3** — two `as TargetHit` casts in `targets.ts` `mapTargetForGeohash`
  (legacy-verbatim); narrow the `targetType` local when revisiting.
- **L1–L5** — `pretest` freshness guard for `dist/`; `CC_LEGACY_DIR` env override
  for the hardcoded legacy path (also follow-up #4); fog style factories →
  `const` tables; `sortIfNeeded` mutates-in-place doc; collapse
  `reconciledSelectedTarget` overloads to the single used signature.
