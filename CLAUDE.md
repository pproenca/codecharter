# AGENTS.md

Telegraph style. Root rules only. Read the nearest scoped `AGENTS.md` before
subtree work.

CodeCharter turns a codebase into a deterministic, geohash-addressed 2D map.
Treat code structure as geography.

## Start

- Runtime: Node >=22, ESM, pnpm workspaces.
- Product language: read `CONTEXT-MAP.md`, then `CONTEXT.md`.
- Package language: read `core/CONTEXT.md` before core work and
  `viewer/CONTEXT.md` before viewer work.
- Principles: read `docs/PRINCIPLES.md` — the invariants that guard durable,
  shared map identity. The one test for any design or review: does this protect
  or fracture that identity?
- ADRs: read `docs/adr/` when touching stable addresses, sidecar storage,
  geohash levels, Deep Links, activity telemetry, or discovery fog.
- Prefer exploring local source before asking questions local context can
  answer.
- Fix, triage, review, and design answers need source context, relevant tests,
  current behavior, and ADR or dependency contract proof where applicable.
- If design decisions are unclear, use the `grill-me` skill: ask one question at
  a time and include a recommended answer.
- For architecture decisions and drift checks (does this protect or fracture map
  identity?), use the `codecharter-architecture` skill when available; it carries
  the `docs/PRINCIPLES.md` guardrails.
- For spatial indexing, geohashing, map navigation, or codebase-as-map work, use
  the `geohash-spatial-code-maps` skill when available.
- For test selection and verification, use the `codecharter-testing` skill when
  available.
- For documentation work, use the `codecharter-docs` skill when available.
- For bug diagnosis, use `codecharter-debugging` for CodeCharter-specific
  boundaries or the generic `diagnose` skill for a full reproduce-minimize loop.
- New docs, tests, prompts, and generated messages use `codecharter://`.
  Legacy `codemap://` remains parseable input only.

## Map

- Product/shared docs: `README.md`, `VISION.md`, `CONTEXT.md`, `docs/`.
- Context routing: `CONTEXT-MAP.md`.
- Core package: `core/`.
- Viewer package: `viewer/`.
- Core CLI: `core/bin/codecharter.mts`.
- Core public barrel: `core/src/main/index.ts`.
- Viewer app shell: `viewer/src/main/app.ts`.
- Viewer render model: `viewer/src/main/render/`.
- Viewer static source: `viewer/web/`.
- Generated viewer bundle: `viewer/dist/`.
- Root package output: `dist/`.
- Stable Map Sidecar: `.codecharter/codecharter.json`.
- Named Places Store: `.codecharter/named-places.json`.
- Local issues, PRDs, screenshots, scratch codemaps, and local activity
  artifacts: `.scratch/`.

## Architecture

- The first stable map unit is still **File**.
- The Map Sidecar is canonical base geography. Tiles, source panels, discovery
  fog, activity trails, and named-place overlaps are derived.
- Preserve stable coordinates across regeneration when the Projection Contract
  still matches. Repacking is explicit, not background cleanup.
- Use geohash prefixes as the common spine for Map Levels, tiles, addresses,
  selections, Named Places, and activity.
- Keep `codecharter://` as the cross-tool Deep Link contract. Browser hash
  routes are viewer-local UI state.
- Keep activity telemetry best-effort and separate from stable map geography.
  Dropping malformed or unmapped activity is better than blocking code work.
- Core owns generation, address resolution, selections, Named Places, activity
  ingestion, setup helpers, the CLI, and the hardened localhost API.
- Viewer owns canvas interaction, hash routes, render-model derivations, source
  inspection, activity visuals, and discovery fog.
- Viewer state should derive from Map Sidecar and core API responses; do not
  create a second semantic identity model in the browser.
- Server changes must keep localhost hardening, body limits, map validation,
  and path containment explicit.
- Generated artifacts are contracts when published, but do not hand-edit them
  when source generation is available.

## Commands

- Install: `pnpm install`.
- Build: `pnpm build`.
- Typecheck: `pnpm typecheck` (`tsgo`).
- Lint: `pnpm lint` (`oxlint`).
- Format: `pnpm format` / `pnpm format:check` (`oxfmt`).
- Test: `pnpm test`.
- Full local check: `pnpm check`.
- Generate map: `pnpm generate`.
- Serve viewer/API: `pnpm serve`.
- CLI: `pnpm codecharter -- <command>`.
- Common CLI commands: `generate`, `resolve`, `serve`, `dev`, `doctor`, `init`.
- Package manager/runtime: repo defaults only. No swaps without approval.

## Validation

- Docs-only changes: `git diff --check`.
- Core behavior changes: run focused core tests, then `pnpm test` when feasible.
- Viewer behavior changes: `pnpm build`; inspect in a browser when the
  changed surface is visual or interactive.
- Published surfaces, CLI wiring, package output, or dynamic import boundaries:
  run `pnpm build` before handoff.
- If proof is blocked, report the exact missing command, dependency, or runtime
  condition.

## Code

- TypeScript ESM, strict. Avoid `any`; prefer real types, `unknown`, and narrow
  adapters.
- Formatting is `oxfmt`, not Prettier. Linting is `oxlint`. Typechecking is
  `tsgo`.
- External JSON/input boundaries should use existing validation helpers or
  explicit narrowing.
- Keep geohash math deterministic: longitude encodes first, the base32 alphabet
  is fixed, and edge handling is contract behavior.
- Keep map generation deterministic: no filesystem-order, map/set, or glob
  nondeterminism in serialized geography.
- Prefer closed codes and discriminated unions over freeform strings.
- Prefer early returns over nested condition pyramids.
- Split gather -> normalize -> decide -> act.
- Use named intermediates for domain meaning, not temporary-variable noise.
- Comments should explain tricky map, security, or stability constraints; avoid
  narration of obvious code.
- Do not edit `node_modules`.

## Tests

- Root tests include Node test files under `test/` plus workspace tests.
- Prefer focused behavior tests over snapshot churn or docs string greps.
- Core tests for generation, stability, geohash levels, resolver behavior,
  selections, server safety, and activity normalization belong in `core/src/test/`.
- Viewer tests should target render-model helpers where possible instead of
  only browser wiring.
- Do not update fixtures, baselines, or generated expected files just to silence
  failures without understanding the changed contract.

## Docs And Issues

- Use glossary terms from `CONTEXT.md`, `core/CONTEXT.md`, and
  `viewer/CONTEXT.md`. Avoid synonyms those files explicitly reject.
- If a proposed change contradicts an ADR, call that out directly.
- Issues and PRDs live under gitignored `.scratch/`; see
  `docs/agents/issue-tracker.md`.
- Triage labels use `docs/agents/triage-labels.md`.
- New user-visible behavior should update README or docs when the current docs
  would become misleading.

## Git

- You may be in a dirty worktree. Never revert changes you did not make unless
  explicitly requested.
- Stage intended files only.
- No manual stash, autostash, branch switches, or destructive git operations
  unless explicitly requested.
- Commit messages should be concise and grouped by coherent topic.

## Security

- Never commit credentials, real tokens, private machine paths that are not part
  of a local-only instruction, or live user activity archives.
- Treat localhost server routes and source-file reads as security-sensitive.
- Keep generated-map ignores and local-only scratch artifacts out of published
  package surfaces unless intentionally designed.
- Dependency changes, package output changes, and release/version bumps need
  explicit approval.
