---
name: codecharter-docs
description: Write or review CodeCharter documentation, ADRs, context docs, README updates, and agent process docs with stable map terminology.
---

# CodeCharter Docs

Use this skill when writing, editing, or reviewing CodeCharter documentation.

## Core Model

Documentation should help developers understand and operate the Code Map without
inventing new vocabulary.

- Lead with what the reader is trying to do or understand.
- Use one recommended path before alternatives.
- Keep examples runnable against this repo.
- Link to context docs and ADRs instead of duplicating contracts.
- Put stability, security, and telemetry caveats exactly where they affect a
  decision.

## Read First

- `CONTEXT-MAP.md` for routing.
- `CONTEXT.md` for product-wide glossary.
- `core/CONTEXT.md` for core docs.
- `viewer/CONTEXT.md` for viewer docs.
- `docs/adr/` for stable address, sidecar, geohash level, Deep Link, and
  telemetry decisions.

## Writing Style

- Use present tense and active voice.
- Prefer short paragraphs and scannable lists.
- Use CodeCharter terms exactly: Code Map, Stable Map, Map Sidecar, Code Plane,
  Map Address, Deep Link, Browser Hash Route, Map Level, Region, Folder, File,
  Named Place, Drawn Selection, Covering Set, Resolved Target, Activity Stream,
  Activity Archive, Activity Producer, and Discovery Fog.
- Avoid glossary-rejected synonyms.
- Use `codecharter://` in new examples. Treat `codemap://` as legacy input.
- Avoid marketing language and vague claims.
- Keep local-only agent process details in `docs/agents/` or `AGENTS.md`, not
  product docs.

## Page Shapes

- README: quick project overview, install/build/test/generate/serve commands,
  and package map.
- VISION: product direction and guardrails.
- CONTEXT files: canonical domain vocabulary and implementation map.
- ADR: one decision, considered options, and consequences.
- Agent docs: local workflow instructions for issues, triage, domain docs, or
  skill routing.

## Verification

- Always run `git diff --check` for docs-only edits.
- If a doc includes a command, run it when feasible or say why not.
- If a doc describes CLI output, server API shape, generated sidecar fields, or
  viewer behavior, inspect source or generated output before changing prose.

## Review Pass

1. Remove duplicated glossary text.
2. Replace loose synonyms with canonical terms.
3. Move caveats near the step or concept they affect.
4. Check links and command names.
5. Confirm ADR alignment.
