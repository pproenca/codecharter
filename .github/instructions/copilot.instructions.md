# CodeCharter Codebase Patterns

Always reuse existing code before adding a new helper.

## Tech Stack

- Runtime: Node >=22.
- Language: TypeScript, ESM, strict mode.
- Package manager: pnpm workspaces.
- Build: esbuild through `scripts/build.mjs`.
- Lint/format: Oxlint and Oxfmt.
- Typecheck: tsgo.
- Tests: Node test runner for root smoke tests and workspace package tests.
- CLI: `core/bin/codemap.mts`, exposed as `codecharter` and legacy `codemap`.

## Source Of Truth

- Product language: `CONTEXT.md`.
- Context routing: `CONTEXT-MAP.md`.
- Core language and module map: `core/CONTEXT.md`.
- Viewer language and module map: `viewer/CONTEXT.md`.
- Stable address decisions: `docs/adr/`.
- Root agent policy: `AGENTS.md`.

## Anti-Redundancy Rules

- Search for existing geometry, geohash, resolver, selection, source, and
  activity helpers before adding a new implementation.
- Do not duplicate browser route parsing in core or Deep Link parsing in the
  viewer.
- Do not create viewer-only identity models for targets already represented by
  core API data.
- Do not add local formatting or duration helpers when a local utility already
  covers the need.

## Architecture Rules

- The first stable map unit is File.
- The Map Sidecar is canonical base geography; overlays are derived.
- Use geohash prefixes as the common spine for Map Levels, tiles, addresses,
  selections, Named Places, and activity.
- New cross-tool addresses use `codecharter://`; parse `codemap://` only for
  legacy compatibility.
- Activity telemetry is best-effort and must not block code work.
- Hardened localhost server constraints are security-sensitive.

## Code Quality

- Use `.js` extensions for TypeScript ESM imports where emitted JavaScript will
  import the file.
- Use `import type` for type-only imports.
- Avoid `any`; use real types, `unknown`, and explicit narrowing.
- Normalize ordering before serializing map data.
- Prefer focused behavior tests over snapshot churn.

## Commands

- Install: `pnpm install`.
- Build: `pnpm build`.
- Typecheck: `pnpm typecheck`.
- Lint: `pnpm lint`.
- Format check: `pnpm format:check`.
- Test: `pnpm test`.
- Full check: `pnpm check`.
- Generate map: `pnpm generate`.
- Serve viewer/API: `pnpm serve`.
- CLI: `pnpm codecharter -- <command>`.
