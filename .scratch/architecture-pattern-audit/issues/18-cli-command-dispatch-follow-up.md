# Consider a CLI command dispatch registry

Status: follow-up
Labels: architecture, cli, lower-priority, strategy

## Observation

`bin/codemap.mjs` still has a long top-level command dispatch chain in `main()`. Commands such as `doctor`, `generate`, `init`, `dev`, `resolve`, `activity`, and `serve` each parse options and orchestrate their own subsystem flow inline.

## Pattern Check

Command was considered and rejected for now. The CLI does not need undo/redo, queueing, scheduling, replay, macro recording, or command identity beyond the command name.

Functional Strategy may eventually apply because each CLI command is a runtime-selected behavior. The current risk is scope: extracting all command handlers would touch most CLI behavior at once, and a partial registry would add indirection without reducing enough coupling.

## Recommended Follow-Up

Defer until another CLI feature forces a command-surface change. Then extract one command at a time behind a small registry such as `{ names, run }`, starting with a low-risk command (`doctor` or `generate`) and preserving public CLI behavior with focused command tests.

## Current Verification

No code change in this issue. The current full suite passed after the surrounding audit loop:

- `pnpm test`

