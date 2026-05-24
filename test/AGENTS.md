# Root Test Guide

This directory holds root-level smoke and package-output tests.

## Scope

- Use root tests for publishable package behavior, CLI smoke checks, and
  cross-workspace contracts that do not belong cleanly inside `core/src/test/`
  or `viewer/src/test/`.
- Prefer package-local tests for core engine behavior and viewer render-model
  behavior.

## Guardrails

- Do not make root smoke tests depend on local `.codecharter/` or `.scratch/`
  state unless the test creates and cleans its own temporary workspace.
- Keep smoke tests deterministic and independent of current repository activity
  telemetry.
- Do not update generated expected output to silence failures without
  understanding whether the Map Sidecar, Deep Link, or package contract changed.

## Validation

- Use `pnpm test` for the full current test contract.
- For one root smoke file, use `node --test test/<file>.mjs` when a narrower
  loop is useful.
