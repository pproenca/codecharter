---
name: codecharter
description: Use when a prompt asks Codex to inspect a CodeCharter map annotation, includes a codecharter:// deep link, includes a CodeCharter resolve command, or asks for code context from a CodeCharter selection.
---

# CodeCharter

Use the CodeCharter CLI as the communication path. For agents, the CLI contract is one command: `resolve`.

Compact prompts use `codecharter --json resolve ...`. If `command -v codecharter` fails, prefer local runners before package fetch:

1. `./node_modules/.bin/codecharter --json resolve ...`
2. `./node_modules/.bin/tsx core/bin/codemap.mts --json resolve ...` when this is a CodeCharter source checkout
3. `npx --yes codecharter@0.1.0 --json resolve ...`

## CodeCharter Prompts

CodeCharter prompts may include:

- one or more `codecharter --json resolve ...` commands
- a `codecharter://annotation/<id>` deep link
- a target count
- a user note describing what to investigate

## Workflow

1. Run the pasted `CLI:` command exactly. If it includes `--server <url>`, keep it; that means the annotation belongs to the running viewer, not necessarily the current workspace.
2. If the binary is missing, rerun the same resolve through `./node_modules/.bin/codecharter`, `./node_modules/.bin/tsx core/bin/codemap.mts`, then `npx --yes codecharter@0.1.0` in that order.
3. Treat `resolvedTargets` from the resolve output as the authoritative target list.
4. Read only the needed resolved target files and ranges with normal Codex file-reading tools. If those paths are not present in the current workspace, report a CodeCharter map/workspace mismatch instead of guessing.
5. If no deep link or resolve command is present, ask the user to copy a fresh CodeCharter prompt from the viewer.

## Fallbacks

- Use `./node_modules/.bin/codecharter --json resolve ...` when the package is installed locally.
- Use `./node_modules/.bin/tsx core/bin/codemap.mts --json resolve ...` in a source checkout that has not built the package bin.
- Use `npx --yes codecharter@0.1.0 --json resolve ...` only after local runners are unavailable.
- Ask the user to run `codecharter init` if the map sidecar is missing.
- Ask the user to run `codecharter dev` only when they need the local viewer or live activity overlay.

## Do Not

- Do not use any agent-facing CodeCharter command except `resolve`.
- Do not bulk-read every file under a selected area.
- Do not use CodeCharter as a source-file reader; Codex should read resolved target files directly.
- Do not use browser automation for normal CodeCharter prompt handling.
- Do not run human commands such as `init`, `dev`, or `clear` unless the user asks.

## Examples

```sh
codecharter --json resolve "codecharter://annotation/<id>"
./node_modules/.bin/codecharter --json resolve "codecharter://annotation/<id>"
./node_modules/.bin/tsx core/bin/codemap.mts --json resolve "codecharter://annotation/<id>"
npx --yes codecharter@0.1.0 --json resolve "codecharter://annotation/<id>"
```
