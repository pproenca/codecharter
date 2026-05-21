# Extract Codex hook tool-input path strategies

Status: fixed
Labels: architecture, codex-hook, strategy, tdd

## Problem

`src/codex-hook.js` selected tool-input path extraction with inline `tool_name` conditionals. Unsupported structured write variants such as `write_file` fell through to dirty-file fallback, which could emit unrelated changed files as Codex activity.

## Pattern Check

Strategy applies in functional form: the algorithm for extracting changed paths varies by runtime tool family (`apply_patch`, structured edit/write tools), and new Codex or plugin tools should not keep expanding one conditional block.

Class-based Strategy was rejected. The algorithms are small and JavaScript functions are enough; no object lifecycle or runtime setter is needed.

## TDD Slice

Added a public codex-hook behavior test proving a `write_file` payload records only the explicit `filepath`, even when another code file is dirty. Then replaced the inline branches with `TOOL_INPUT_PATH_STRATEGIES` and added the `write_file`/`edit_file` family.

## Verification

- `node --test --test-name-pattern "structured write-file" test/init.test.js`

