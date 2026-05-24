# Scripts Guide

This directory owns local build and validation helpers.

## Wrapper Rules

- Prefer existing pnpm scripts before adding new standalone helpers.
- Keep root `package.json` scripts, script implementation, and validation
  guidance in `AGENTS.md` aligned.
- Use `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
  `pnpm test`, `pnpm generate`, and `pnpm serve` as the public seams unless a
  narrower script is deliberately
  introduced.
- Do not add package-manager-specific helpers that bypass the pnpm workspace
  contract without explicit approval.

## Generated Outputs

- If a script writes generated artifacts, document the source of truth and the
  check or regeneration command.
- Keep generated viewer output, publishable `dist/`, and map sidecars out of
  hand edits when the generator can produce them.
- Prefer deterministic ordering in generated JSON and generated text.

## Build Scripts

- `scripts/build.mjs` builds the publishable root package: bundled CLI,
  bundled viewer assets, and the manifest used for `--version`.
- Build changes affect package output and should be verified with
  `pnpm build`.
- If build output shape changes, inspect `dist/` enough to prove the package
  layout still matches the CLI/server expectations.

## Scope

- Keep script-runner behavior and generated-artifact guidance here.
- Keep repo-wide verification and architecture policy in root `AGENTS.md`.
