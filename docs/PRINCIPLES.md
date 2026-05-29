# Architectural Principles

The invariants that guide CodeCharter decisions — the guardrails against drift
that architectural tests can't catch. ADRs in [`docs/adr/`](adr/) instantiate
these; this file is the _why_ behind them. Read with
[`VISION.md`](../VISION.md) and [`CONTEXT.md`](../CONTEXT.md).

## The thesis

CodeCharter sells exactly one thing: **durable, shared, reviewable _identity_
for places in code.** The same address means the same place — for a human or an
agent, today or in five years, across the CLI, the viewer, a Deep Link, and a
diff.

Every principle below defends that identity against one specific kind of drift.
When a decision is hard, the question is always:

> **Does this protect or fracture durable shared identity?**

Each principle names the **cost it knowingly accepts** — a principle without its
tradeoff gets abandoned the first time the cost bites. The cost is the point.

## The principles

**1. Addresses are promises, not layout output.** Once a place has a Map
Address it keeps it; new and deleted files heal locally inside their folder
region; the map never reflows to pack better, and repacking is an explicit,
reviewed act — never background cleanup.
_Everything durable hangs off the address — spatial memory, Deep Links, Named
Places, activity trails, reviewable diffs — so moving it silently breaks all of
them at once. We accept looser packing and wasted space to keep the promise._

**2. One spine: the geohash levels.** Tiles, Map Levels, Map Addresses,
covering sets, Named Places, and Activity all derive from the single geohash
level table; new caches derive from the spine, never replace it.
_A single spatial model is the only way the algorithm and the human navigation
model stay the same thing. The first time rendering gets "just its own"
coordinates, identity forks into N incompatible maps. We accept that no feature
gets to locally optimize its own coordinates._

**3. One truth: the Map Sidecar.** `.codecharter/codecharter.json` is canonical
base geography; tiles, fog, source panels, activity, and overlaps are _derived_;
faster indexes are generated _from_ it, never instead of it.
_One source of identity is what makes diffs reviewable and stops two systems
disagreeing about where a file is. JSON because inspectable-by-everyone (human,
agent, test, CLI, web) beats density — for now; we accept it isn't the fastest
store._

**4. One portable address: `codecharter://`.** The URI is the cross-tool
contract; browser hash routes wrap it and human breadcrumbs describe it, but
neither becomes "the address." Legacy `codemap://` parses in; only
`codecharter://` is emitted.
_The whole point is a human and an agent naming the same place across tools and
time. A second canonical scheme means two things claim to be the address, and
every saved reference rots. We accept a less path-like canonical form._

**5. Activity is an overlay, never the map.** Events are best-effort — accepted
instantly, dropped if malformed or unmapped, never blocking code work; discovery
fog is derived viewer state, never persisted geometry. Every _accepted_ event
still resolves through the same Map Address contract.
_Telemetry that can stall real work is worse than no telemetry; the map's
integrity must never depend on the timeline's reliability. Overlays borrow
identity — they don't invent it. We accept that activity is lossy._

**6. Determinism is the floor everything else stands on.** Same input →
byte-identical map; geohash math is fixed (longitude encodes first, frozen
base-32 alphabet, contract edge handling); no filesystem-order, map/set, or glob
nondeterminism reaches serialized geography.
_Stable addresses, reviewable diffs, and reproducible Deep Links are all
impossible without it — nondeterminism makes every other invariant unverifiable.
We pay for it by sorting and pinning instead of taking "whatever order it comes
in."_

**7. Local-first is not casual about trust.** The server reads your source and
serves your map, so the Host allowlist, body limits, codemap validation, and
path containment are product requirements — explicit, bounded, testable; and the
viewer renders core's truth, never inventing its own identity model.
_"It's just localhost" is exactly how a source-reading tool grows an
exfiltration or path-escape hole. We accept hardening ceremony on every route,
because the alternative is a quiet, convenient breach._

## Using these

- They are **decision guardrails**, not laws of physics (echoing VISION's "What
  We Will Not Merge"). Strong user demand and strong technical rationale can
  evolve them — but a change that touches **durable identity** (principles 1–4, 6) must be explicit, reviewed, and ADR-aware, never a silent side effect.
- The ADRs record the specific decisions; do not re-litigate them here — extend
  or supersede them with a new ADR.
- If a proposed change can't answer "this protects durable shared identity"
  cleanly, that's the signal to stop and write down why before proceeding.
