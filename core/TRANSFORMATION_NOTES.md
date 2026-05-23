# Transformation Notes — `geohash` → `@codecharter/core`

*Slice 1 of the codecharter modernization (per `analysis/MODERNIZATION_BRIEF.md`, Phase 2 seed).*
*TS → TS idiomatic restructure. **No behavior change** — proven byte-equivalent. 2026-05-23.*

## Outcome

- **Tests:** 91/91 pass (`npm test`) — 79 characterization (golden values captured from the legacy oracle) + 12 differential driving ~20,000 fuzzed legacy-vs-modern comparisons.
- **Typecheck:** clean under `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` (`tsc --noEmit`).
- **Equivalence proof:** the differential suite (`src/test/geohash.differential.test.ts`) imports **both** the legacy module and the modern one and asserts identical `encodeGeohash` strings, identical `decodeGeohashBounds` boxes, identical `codePointToGeo`/`geohashForBoundsCenter` output, **and identical thrown error messages**, across boundary values + every BASE32 char + a seeded random sample at precisions 1–12. This is the P0 (BR-001) determinism gate.
- **Legacy retired:** `legacy/codecharter/src/geohash.ts` (170 LOC, complexity 31) is now fully reproduced and superseded by this package. It is not yet deleted — it stays until its 7 importers (Phase 2/3) switch to `@codecharter/core`.

## Behavior → source mapping (legacy → target)

| Behavior / rule | Legacy `src/geohash.ts` | Target |
|---|---|---|
| BASE32 alphabet + decode table | `:4-5` | `geohash.ts:38-39` (now a `Map`) |
| East-edge epsilon `1e-12` | `:6` | `geohash.ts:50` |
| `GeoCoordinate / GeohashBounds / GeohashedCoordinate / CodePlaneDescriptor` types | `:10-34` | `geo-types.ts:24-58` (re-exported from `geohash.ts`) |
| `Point` / `Bounds` (were imported from `geometry.ts`) | `geometry.ts` | `geo-types.ts:10-22` (seeded) |
| `clamp` (was imported from `util.ts`) | `util.ts:17-19` | `math.ts:11-13` (byte-identical) |
| **BR-001** `encodeGeohash` | `:50-99` | `geohash.ts:61-121` |
| **BR-002** `decodeGeohashBounds` | `:101-128` | `geohash.ts:124-159` |
| BR-001 `codePointToGeo` | `:130-142` | `geohash.ts:167-180` |
| BR-001 `geohashForBoundsCenter` | `:144-154` | `geohash.ts:185-196` |
| `codePlaneDescriptor` | `:36-48` | `geohash.ts:202-215` |
| `wrapLongitude` (BR-001) | `:166-169` | `geohash.ts:217-220` |
| `midpoint` / `bisectRange` helpers | `:156-164` | inlined into encode/decode |
| Public entry point | *(none — single file)* | `index.ts` + `package.json` `exports` |

## Deliberate deviations (structural only — zero behavioral change)

1. **Split into three files** (`geo-types.ts`, `math.ts`, `geohash.ts`) + an `index.ts` barrel, seeding `@codecharter/core`. Legacy was one file reaching into `util.ts`/`geometry.ts`.
2. **`Object.fromEntries` decode table → `Map`** (`geohash.ts:39`). Idiomatic, no prototype-pollution surface, `.get()` returns `number | undefined` which satisfies strict null checks. Output identical (verified by differential test across all chars).
3. **Inlined the `midpoint`/`bisectRange` helpers and the `Range` tuple type.** Each had a single use; inlining keeps the numeric kernel readable in one place. The arithmetic (`(min+max)/2`, `>=` tie to upper half, endpoint reassignment) is **unchanged** — this is mandatory for byte-equivalence.
4. **Named constants + JSDoc** linking each export to its rule ID (BR-001/BR-002); `DEFAULT_PRECISION = 12`.

### Behavior intentionally PRESERVED (would be a "fix" — out of scope here)
- **`encodeGeohash(0, 180)` wraps to `-180`** (≡ `encodeGeohash(0, -180)`). `wrapLongitude` uses the half-open `[-180, 180)`, so +180 is *not* its own easternmost cell. Pinned by tests; flagged for SME (does the easternmost meridian deserve its own cell?). **Do not "fix" without a rule change.**
- **Midpoint ties resolve to the UPPER half** (the `>=` comparison). Load-bearing for every address.
- **`clamp` argument order** `Math.min(max, Math.max(min, value))` — preserved exactly (NaN/inverted-range behavior is identical).
- **Error message strings are now frozen** by the differential test (it asserts `modern.message === legacy.message`). A future contributor must NOT reword them, and typed/domain errors may only be introduced if `.message` stays byte-identical. Documented because it is a non-obvious constraint.

## What was NOT migrated

- `decodeGeohashBounds` (BR-002) has **no production caller** in legacy (only tests use it — see `ASSESSMENT.md` dangling refs). It was migrated anyway: it is the documented inverse of `encodeGeohash`, the differential gate needs it, and dropping a public, tested function would be a silent API reduction. No dead branches were dropped — the module had none.
- Nothing else omitted; the module is small and fully reachable.

## Architecture review (architecture-critic)

**HIGH — applied:**
- ✅ **No package entry point** → added `exports` map (`.` → `index.ts`, `./geohash` → `geohash.ts`) and an `index.ts` public barrel.
- ✅ **Name/scope mismatch** (`@codecharter/geohash` housed core-wide `geo-types`/`math`) → renamed package to **`@codecharter/core`**; geohash is one export, the seeded primitives now sit under their true scope.

**MEDIUM / LOW — recorded (not applied, with rationale):**
- *Error handling is stringly-typed.* Acceptable for a leaf numeric kernel; **and** the messages are now frozen by the differential gate (above), so typed errors would have to preserve `.message`. Deferred.
- *`BASE32.charAt()` returns `""` on out-of-range index.* Latent only — `charIndex` is 0..31 by the 5-bit accumulator; added an invariant comment (`geohash.ts:115-117`) rather than switching to indexed access (which equivalence forbids gratuitously churning).
- *`codePlaneDescriptor` ships formulas as opaque strings* (`"x >= 1 ? 179.999999999999 : ..."`). Carried from legacy and test-pinned. Design smell: the strings are hand-maintained beside the real expressions and must be edited in lockstep. A future descriptor exposing numeric constants (`xScale`, `xOffset`, `eastEdge`) behind a version bump is the cleaner contract — deferred.
- *`codePointToGeo` uses `point?.x` though `point: Point` is non-nullable.* Kept as a public-boundary guard against untyped JS callers (matches legacy); signature/guard mismatch noted, not churned.
- *Mutable `let` bisection state.* Idiomatic for a numeric kernel; no change.

## Follow-ups for dependent modules (next slices)

- **7 importers** of legacy `geohash` must repoint to `@codecharter/core` when transformed: `district-layout`, `generator`, `resolver`, `stability`, `tiles`, `tree`, `selections`.
- **`geometry.ts`** is the next natural slice — it owns the real `Point`/`Bounds` + `roundBounds` (BR-004) that this slice only *seeded* as types. When it lands, move/Merge `geo-types.ts` into the geometry module and have geohash import from it. **Note the legacy dual `roundBounds`** (BR-004 suspected defect) to resolve then.
- **`levels.ts`** (BR-003) carries the level→precision table that feeds `precision` here; transform it alongside, and resolve **Open Question Q5** (line/token both precision 12) at that point.
- **`util.ts`**: `clamp` was seeded into `math.ts`; when `util.ts` is transformed, dedupe so there is one `clamp`.
- Keep the **differential test pattern** as the equivalence template for every subsequent pure-core slice (it is the brief's Phase 2 gate).

---

# Update — Full pure-core extraction (Phase 2 complete)

The single geohash slice was extended into the **complete pure `@codecharter/core` engine**. Every deterministic module from legacy `src/` is now transformed and proven byte-equivalent.

**Status: 140 tests passing, `tsc --noEmit` clean (full strict mode), zero runtime dependencies.**

## Modules transformed (`src/main/`)

| Module | Rules | Legacy source | Equivalence proof |
|--------|-------|---------------|-------------------|
| `math.ts` | BR-004 (round), clamp | `util.ts:13-19` | differential fuzz |
| `collections.ts` | sort/compare/record helpers | `util.ts:21-69` | differential fuzz |
| `geometry.ts` | BR-004 + rect math | `geometry.ts` | differential fuzz |
| `geo-types.ts` | Geo* types | `geohash.ts:10-34` | type surface |
| `levels.ts` | BR-003 | `levels.ts` | differential + characterization |
| `geohash.ts` | **BR-001**, BR-002 | `geohash.ts` | golden + differential (~20k) |
| `deep-links.ts` | BR-029 | `deep-links.ts` | differential + characterization |
| `overlaps.ts` | BR-015 | `overlaps.ts` | differential + characterization |
| `tiles.ts` | BR-013 | `tiles.ts` | differential (codemap fuzz) |
| `line-coordinate.ts` | BR-011, BR-012 | `line-coordinate.ts` | differential fuzz |
| `resolver.ts` | address resolution | `resolver.ts` | differential (codemap fuzz) |
| `selections.ts` | BR-020, BR-028 | `selections.ts` | differential + characterization |
| `tree.ts` | BR-005 | `tree.ts` | end-to-end layout diff |
| `district-layout.ts` | BR-007/008/009/010 | `district-layout.ts` | end-to-end layout diff |
| `treemap.ts` | layout orchestration | `treemap.ts` | end-to-end layout diff |
| `stability.ts` | **BR-051** | `stability.ts` | end-to-end layout diff + stability scenarios |

## Cross-cutting deviations (all behavior-neutral)

- **Dead/test-only wrapper classes dropped** (assessment dangling-refs): `CodemapDeepLinkCodec`, `TileIndexBuilder`, `CodeRangeGeometryMapper`, `AddressResolver`, `DistrictLayoutEngine` (+ its private singleton). Only free functions ship. `FileNode`/`FolderNode` are kept — they are the real domain model.
- **Path-constant duplication killed at the seam**: shared helpers (`round`, `clamp`, sort/compare, `objectRecord`) now live once in `math.ts`/`collections.ts` instead of being re-imported from a grab-bag `util.ts`.
- **Two `roundBounds` preserved deliberately** (BR-004 dual): `geometry.roundBounds` (no floor) and `district-layout.roundBounds` (floors extent at 0). The barrel exports only the geometry one to avoid a name clash; intra-core modules import the layout variant directly. Documented suspected defect, **preserved** pending SME decision.
- **Legacy quirks preserved** (characterization, not "fixed"): geohash `lon=180 → -180` wrap (BR-001); `lineRange`/`tokenRange` both precision 12 (BR-003, Q5); rename = delete+add address loss (BR-051, Q3).

## Phase 2b — generation pipeline (also complete)

The I/O orchestration layer is now transformed too, proven by a **fixture-repo byte-identical-codemap gate** (creates a temp git repo, runs legacy vs modern `generateCodemap`, asserts deep + JSON-string equality — fresh, incremental, and stale-projection paths):

| Module | Rules | Test |
|--------|-------|------|
| `extensions.ts` | BR-021 (dropped tautological `endsWith`) | differential |
| `exec-file.ts` | git exec wrapper (no shell) | via scan/generator |
| `scan.ts` | BR-006, BR-022, BR-023, BR-024 | fixture-repo differential |
| `generator.ts` | BR-014, BR-050 (+ serialization) | fixture-repo byte-identical codemap |
| `collections.mapConcurrent` | parallel scan | via scan |

`generateCodemap({ root })` end-to-end now produces the same `codecharter.json` as legacy.

## Phase 3a — persistence, activity data layer, source & ignore helpers (also complete)

| Module | Rules | Test |
|--------|-------|------|
| `errors.ts` | error guards (from `util.ts`) | via store |
| `store.ts` | **BR-055** atomic JSON write | temp-dir differential |
| `records.ts` | `packageJsonFromValue` etc. (from `util.ts`) | differential |
| `activity.ts` | **BR-044** event model + normalize | differential |
| `activity-change-range.ts` | **BR-016** unified-diff parsing | differential fuzz |
| `activity-store.ts` | **BR-046/047** in-memory + JSONL archive | temp-file characterization + diff |
| `source.ts` | **BR-039/056** bounded source read | temp-file differential |
| `local-git-exclude.ts` | **BR-054** (ignore patterns) | git-fixture differential |

> **`util.ts` is fully retired** — its contents are split across `math` (clamp/round), `collections` (sort/compare/objectValues/objectRecord/mapConcurrent), `records` (package/string coercion), and `errors` (errno/message). The legacy file remains only until its last importers (the modules below) switch over.

## Phase 3b — HTTP server (complete, with Q4 hardening)

`server.ts` is transformed: legit GET endpoints are **differentially identical** to the legacy server (real running-server fixture), and per **Q4 = codemap may be untrusted** it adds deliberate hardening, each verified by a security test:

| Hardening | CWE / finding | Test |
|---|---|---|
| `Host`/`Origin` allowlist | CWE-350/346 DNS rebinding | non-local Host → 403 |
| `/api/source` + static path containment | CWE-22 | poisoned codemap key → 400 (no escape) |
| Codemap schema validation + mtime:size cache | BR-037 + debt #4 | corrupt map → 500 clear error |
| Request-body size cap (1 MB) | CWE-400/770 DoS | oversized body → 413 |

`isCodecharterCodemap` was added to `resolver` for the validation gate. The god-file was kept as one module (route table intact); splitting into `routes/handlers` is a tracked follow-up.

## Phase 3c — activity watcher, setup, codex hook (complete)

The remaining Node orchestration entry points are transformed:

| Module | Rules | Test |
|--------|-------|------|
| `activity-watcher.ts` | BR-025, BR-049, BR-017 | porcelain differential fuzz + git-fixture diff + poll characterization |
| `init.ts` | BR-054 | `mergeCodexHooks` differential + git-fixture config/hooks diff + idempotency |
| `codex-hook.ts` | BR-040/041/042/043/045 | end-to-end git-fixture differential across event types |

Dead `CodecharterInitializer` dropped (Q7); `CodexHooksMerger` kept internal.

## Status: the entire `src/` library is transformed

**33 modules, 25 test files, 194 tests, `tsc --noEmit` clean, zero runtime deps.** Every legacy `src/*.ts` is now in `@codecharter/core` (`util.ts` retired → `math`/`collections`/`records`/`errors`). The library can scan a repo → generate a byte-identical codemap → resolve addresses/selections/tiles → serve them over a hardened HTTP API → capture agent activity → provision setup — all proven equivalent to legacy.

## Phase 5 — CLI entry (complete)

`bin/codemap.mts` is transformed: a byte-faithful copy re-pointed onto the single `@codecharter/core` barrel (logic now lives in core), plus three type-only fixes where Node's `response.json()` returns `unknown` (vs legacy's inferred `any`). Proven by **CLI-invocation contract tests** (spawn the source CLI via `tsx`):

| Check | Result |
|---|---|
| `generate` | byte-identical codemap vs the **legacy CLI** |
| `resolve --json <path>` | identical address vs the legacy CLI |
| `--version` / `--help` / `doctor --json` | correct output |
| unknown command | exit 1 |

The brief's `cli/args` + `cli/commands/*` split is a tracked cosmetic follow-up (the file kept its structure, like `server.ts`).

## Status: the entire Node side is transformed

**The whole CLI + library is done — 33 core modules + the CLI, 26 test files, 200 tests, `tsc --noEmit` clean, zero runtime deps.** `codecharter generate | resolve | dev | serve | doctor | init | activity | codex-hook | annotations | api` all run over `@codecharter/core`.

## Phase 4 — viewer (COMPLETE: `@codecharter/viewer` package)

The browser viewer is fully transformed and equivalence-proven. Details in
**`modernized/viewer/TRANSFORMATION_NOTES.md`**. Summary:

- **`deep-links.ts`** (BR-030) — 6 differential tests vs legacy + core; `formatRouteNumber` unified with core, **closing debt #3**.
- **`render-model.ts`** (1,620 LOC, 134 exports, BR-018/019) — decomposed into `src/main/render/{types,constants,primitives,lod,camera,fog,activity,source-panel,targets,index}.ts`; **42 differential tests** fuzz the full surface vs legacy (acyclic module DAG, no cycles).
- **`app.ts`** (2,957 LOC DOM/canvas SPA) — faithful port (imports repointed) + esbuild bundle + `web/` shell; proven by a **Playwright DOM-contract + canvas pixel-diff** suite serving the modern AND legacy bundles against the same core backend: **5 states, 0 px diff**.

Viewer totals: `tsc` clean · **48** node:test · **5** e2e. architecture-critic reviewed; HIGH findings applied (see viewer notes).

## Whole-project status

All phases complete and equivalence-proven. `@codecharter/core` (backend + server + hooks + setup + CLI) = **200** tests; `@codecharter/viewer` (deep-links + render-model + app shell) = **48** + **5** e2e. The legacy `codecharter` TypeScript app is fully modernized.
