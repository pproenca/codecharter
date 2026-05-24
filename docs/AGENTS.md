# Docs Guide

This directory owns CodeCharter docs, ADRs, and local agent-facing process
notes.

## Domain Language

- Read `CONTEXT-MAP.md` and `CONTEXT.md` before writing product-facing docs.
- Use glossary terms exactly: Code Map, Stable Map, Map Sidecar, Map Address,
  Deep Link, Map Level, Named Place, Activity Stream, Activity Archive, and
  Discovery Fog.
- Avoid synonyms the context files reject, such as file tree replacement,
  browser route as canonical address, tile cache as source of truth, or activity
  as map history.
- Use `codecharter://` in new examples. Mention `codemap://` only as legacy
  parseable input.

## ADRs

- ADRs under `docs/adr/` are design constraints, not background reading.
- When docs touch stable addresses, sidecar shape, geohash levels, Deep Links,
  activity telemetry, or discovery fog, read the matching ADR before editing.
- If a proposed doc change contradicts an ADR, say so explicitly instead of
  silently writing around it.

## Docs Style

- Lead with the task or product concept the reader is trying to understand.
- Prefer one recommended path before alternatives.
- Keep examples runnable against this repo's npm scripts and CLI.
- Keep local paths generic unless the doc is specifically for local agent
  workflow.
- Do not add screenshots, generated maps, or local activity artifacts to docs
  unless the user asks.
- Link to `CONTEXT.md`, package context files, or ADRs instead of duplicating
  glossary definitions across pages.

## Local Agent Docs

- `docs/agents/` documents local issue, triage, and domain-doc workflows.
- Issues and PRDs live under gitignored `.scratch/`; do not treat `.scratch/`
  as portable project history.
- Keep agent process docs concise and operational. Product design belongs in
  `VISION.md`, `CONTEXT.md`, and ADRs.

## Validation

- Docs-only changes require `git diff --check`.
- If docs include commands, run the smallest command that proves the example
  when feasible.
- If docs describe current CLI output, server routes, sidecar shape, or viewer
  behavior, inspect the current source or generated output before updating.
