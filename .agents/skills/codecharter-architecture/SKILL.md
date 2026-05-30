---
name: codecharter-architecture
description: Apply CodeCharter's architectural principles as decision guardrails when designing, reviewing, or refactoring — the invariants that protect durable, shared, reviewable map identity and that architectural tests can't catch. Use when a change touches stable addresses, the geohash spine, the Map Sidecar, deep links, activity/fog, determinism of serialized geography, or localhost hardening; when judging whether a design or PR causes drift; or when someone proposes a new coordinate scheme, store, address form, or browser-side identity model. Complements `improve-codebase-architecture` (general depth/seams) — this one is about CodeCharter's specific invariants.
---

# CodeCharter Architecture

The canonical principles live in [`docs/PRINCIPLES.md`](../../../docs/PRINCIPLES.md)
with full motivation; the ADRs in `docs/adr/` instantiate them. This skill
carries the decision heuristic — **read the doc, don't duplicate it** (that is
principle #3 applied to itself).

## The one question

CodeCharter sells exactly one thing: **durable, shared, reviewable _identity_
for places in code** — the same address means the same place, for a human or an
agent, today or in five years, across the CLI, the viewer, a Deep Link, and a
diff. For any design, review, or refactor, ask:

> **Does this protect or fracture durable shared identity?**

If it can't answer cleanly, stop and write down why before proceeding.

## The guardrails (each defends identity against one drift)

1. **Addresses are promises, not layout output** — no reflow-by-default; repack is explicit.
2. **One spine: the geohash levels** — every spatial feature derives from it; caches don't replace it.
3. **One truth: the Map Sidecar** — tiles/fog/activity/panels are derived; indexes generate _from_ it.
4. **One portable address: `codecharter://`** — hash routes wrap it; breadcrumbs describe it; neither replaces it.
5. **Activity is an overlay, never the map** — best-effort, droppable, non-blocking; fog is derived, never persisted.
6. **Determinism is the floor** — same input → byte-identical map; no fs-order/map-set/glob in serialized geography.
7. **Local-first is not casual about trust** — Host allowlist, body limits, codemap validation, path containment are product requirements; the viewer never invents its own identity.

Full statement, motivation, and the **cost each principle knowingly accepts**:
[`docs/PRINCIPLES.md`](../../../docs/PRINCIPLES.md).

## How to apply

- Name the cost. A guardrail without its accepted tradeoff loses the first
  argument where the cost bites — so when you invoke one, state what it costs and
  why that's worth it here.
- Drift is usually a _second_ of something: a second coordinate system, a second
  store of geometry, a second address scheme, a second (browser) identity model,
  or a telemetry coupling that can block work. Watch for "just this once."
- These are guardrails, not laws of physics. They can evolve — but a change to
  durable identity (principles 1–4, 6) must be explicit, reviewed, and ADR-aware,
  never a silent side effect. Don't re-litigate an ADR here; supersede it with a
  new one.
