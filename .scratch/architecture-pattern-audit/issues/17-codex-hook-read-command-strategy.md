# Extract Codex hook read-command strategies

Status: fixed
Labels: architecture, codex-hook, source-context, strategy, adapter, tdd

## Problem

`src/codex-hook.js` parsed read-command path candidates and line ranges with command-name conditionals. That made each new shell read command or option form add more branching, and `tail -n 2 ./src/app.ts` failed to record activity because the option argument and `./` path spelling were handled outside a stable map-path adapter.

## Pattern Check

Strategy applies in functional form: `sed`, `head`, `tail`, `rg`, and generic readers each need command-specific path and line-range parsing selected at runtime by command name.

Class-based Strategy was rejected. The strategies are small stateless functions, so JavaScript function objects are enough. Adapter also applies narrowly to path spelling: shell paths are normalized through the existing map-path adapter before sidecar lookup.

## TDD Slice

Added a public codex-hook behavior test for `tail -n 2 ./src/app.ts`, then introduced `READ_COMMAND_STRATEGIES` and routed shell path normalization through `normalizePathForMap`.

## Verification

- `node --test --test-name-pattern "tail reads" test/init.test.js`
- `node --test test/init.test.js`

