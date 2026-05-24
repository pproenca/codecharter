# CodeCharter Vision

CodeCharter is a spatial interface for understanding code.
It turns a repository into a deterministic, geohash-addressed Code Map that can
be searched, linked, annotated, regenerated, and watched while agents work.

Project overview and developer commands: [`README.md`](README.md)
Domain language and architectural vocabulary: [`CONTEXT.md`](CONTEXT.md)
Design decisions: [`docs/adr/`](docs/adr/)

The premise is simple: large codebases are places.
Developers build spatial memory around packages, domains, features, files, and
hotspots. CodeCharter makes that memory explicit by giving code durable map
addresses instead of treating every navigation session as a fresh file-tree
walk.

The goal: a deterministic Code Map that preserves useful geography over time,
supports durable `codecharter://` Deep Links, and lets humans and AI agents
refer to the same places in a codebase.

The current focus is:

Priority:

- Stable Map Sidecars and deterministic regeneration.
- Accurate path, line, token, selection, and Named Place resolution.
- A usable browser viewer for panning, zooming, searching, selecting, naming,
  and inspecting source.
- Best-effort activity telemetry that shows where agents are reading, editing,
  testing, and reviewing without blocking their work.
- Hardened localhost serving and safe local defaults.

Next priorities:

- Better incremental stability for new, moved, and deleted files.
- Richer domain and feature boundaries beyond the filesystem-first map.
- More useful activity trails and discovery fog for multi-agent workflows.
- Faster rendering and lookup on larger repositories.
- Stronger CLI ergonomics for resolving, sharing, and opening Map Addresses.
- Better setup flows for projects adopting `.codecharter/` sidecars and local
  Codex hooks.

Contribution rules:

- One PR = one issue/topic. Do not bundle unrelated fixes and features.
- Changes to stable addresses, projection metadata, geohash levels, Deep Links,
  or sidecar shape need tests and ADR-aware explanation.
- Viewer changes should preserve the core map identity contract instead of
  inventing browser-only identities.
- Activity telemetry may improve visibility, but it must remain best-effort and
  separate from stable geography.

## Security

CodeCharter is local-first, but not casual about trust boundaries.
The localhost server reads source files and serves map data, so route hardening,
host checks, body limits, codemap validation, and path containment are core
product requirements.

The security tradeoff is deliberate: make local inspection powerful while
keeping risky paths explicit, bounded, and testable.

## Maps And Addresses

The Map Sidecar at `.codecharter/codecharter.json` is the canonical record of
base geography. It stores folders, files, bounds, geohashes, map levels, and
projection metadata. It does not store volatile overlays.

Stable geography matters because it protects:

- Human spatial memory.
- `codecharter://` Deep Links.
- Named Places and drawn selections.
- Agent activity trails and discovery history.
- Reviewable map diffs.

Geohash prefixes are the shared addressing spine. Tiles, Map Levels, Map
Addresses, covering sets, Named Places, and activity should all derive from the
same model.

## Activity And Discovery

Agent activity is an overlay, not the map.
Activity Producers are best-effort. If the map server is unavailable, an event
is malformed, or a path cannot be resolved, code work should continue.

Discovery fog is derived viewer state. It helps users see explored, visible, and
unexplored code regions, but it must not become persisted map geometry or a
source of truth for identity.

## Why TypeScript?

CodeCharter is a local toolchain, JSON contract, CLI, server, and browser
application. TypeScript keeps those surfaces close together and easy to inspect.
The repo stays hackable: deterministic core logic, explicit JSON contracts, and
a viewer that can be built without a heavy runtime dependency stack.

## What We Will Not Merge For Now

- Reflow-by-default layout changes that move existing addresses without an
  explicit repack story.
- New canonical address schemes that bypass `codecharter://`.
- Viewer-only identity models that diverge from the Map Sidecar and core API.
- Activity pipelines that block editing, testing, generation, or serving.
- Persisted discovery/fog state inside the Map Sidecar.
- Server routes that weaken localhost hardening or path containment.
- Large semantic clustering systems that replace the filesystem-first map before
  the stable File-level contract is stronger.
- Heavy dependency additions for behavior the current TypeScript core can keep
  deterministic and inspectable.

This list is a roadmap guardrail, not a law of physics.
Strong user demand and strong technical rationale can change it, but changes
that affect stable geography should be explicit and reviewable.
