# Domain Docs

How engineering skills should consume CodeCharter's domain documentation.

## Layout

This repo uses a multi-context layout.

```text
/
|-- CONTEXT-MAP.md
|-- CONTEXT.md
|-- core/
|   `-- CONTEXT.md
|-- viewer/
|   `-- CONTEXT.md
`-- docs/
    `-- adr/
```

## Before Exploring

- Read `CONTEXT-MAP.md` first. It maps repo paths to the right context files.
- Read root `CONTEXT.md` for product-wide Code Map language.
- Read `core/CONTEXT.md` before changing the core engine, CLI, server, address
  resolver, generation pipeline, activity pipeline, or setup helpers.
- Read `viewer/CONTEXT.md` before changing the browser app, render model, hash
  routes, canvas interactions, source panel, activity visuals, or discovery fog.
- Read relevant ADRs in `docs/adr/` when work touches stable addresses,
  sidecar storage, geohash levels, deep links, activity telemetry, or discovery.

If a file is missing, proceed silently. Do not suggest creating context docs
upfront unless the task is specifically about documentation.

## Use The Glossary's Vocabulary

When output names a domain concept in an issue title, refactor proposal,
hypothesis, test name, or code comment, use terms from the relevant context
file. Do not drift to synonyms the glossary explicitly avoids.

If the concept is not in the relevant context file, either reconsider the term
or note the gap for a future documentation update.

## Flag ADR Conflicts

If output contradicts an existing ADR, surface it explicitly rather than
silently overriding it:

> Contradicts ADR-0004 (Map deep links), but worth reopening because...
