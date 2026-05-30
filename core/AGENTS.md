# Core Guide

This package owns CodeCharter's engine, CLI, setup helpers, and localhost API.
Read `../CONTEXT-MAP.md`, `../CONTEXT.md`, and `CONTEXT.md` before core work.

## Ownership

- Map generation, geohash addressing, address resolution, selections, Named
  Places, source access, activity ingestion, setup helpers, CLI wiring, and the
  hardened localhost server belong here.
- Browser camera state, render derivations, canvas drawing, source-panel
  presentation, and discovery-fog presentation belong in `viewer/`.
- Public CLI/package wiring should import through `core/src/main/index.ts`
  unless a module-internal dependency needs a narrower local import.

## Contracts

- Preserve Stable Map behavior unless an ADR or explicit issue says to change
  the Projection Contract.
- The Map Sidecar remains canonical base geography. Activity and Named Places
  are separate data stores or overlays.
- Keep geohash math deterministic: longitude encodes first, the base32 alphabet
  is fixed, and edge handling is contract behavior.
- Resolver outputs should carry normal Map Address data instead of exposing
  renderer-specific coordinates.
- Malformed or unmapped activity is droppable telemetry, not a fatal workflow
  failure.
- Server route changes must preserve localhost host allowlisting, body limits,
  map validation, and path containment.

## Implementation

- Prefer small pure helpers for geometry, line/token ranges, overlaps, and
  projection decisions.
- Keep serialization deterministic; do not rely on filesystem, object, Map, or
  Set iteration unless order is explicitly normalized.
- Add compatibility for `codemap://` only at parse boundaries. New output uses
  `codecharter://`.
- Do not make generation read viewer state or activity state to decide base
  geography.

## Tests

- Core behavior tests belong in `core/src/test/`.
- Add focused tests for generation stability, geohash levels, resolver output,
  selection resolution, server safety, and activity normalization when those
  contracts change.
- Use `pnpm exec tsx --test core/src/test/<file>.test.ts` for focused core
  proof, then broaden to `pnpm --filter @codecharter/core test` or `pnpm test`
  when the touched contract is shared.
