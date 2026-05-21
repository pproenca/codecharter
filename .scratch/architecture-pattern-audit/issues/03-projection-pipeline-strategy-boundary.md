Title: Add a projection strategy boundary when a second projection exists
Status: needs-triage
Labels: architecture, follow-up

## Problem

`src/generator.js` currently hard-codes the filesystem district projection pipeline: scan files, build the file tree, lay it out, stabilize it, and serialize the Map Sidecar. That is correct for the first stable unit, but future symbol or domain-object projection will need a stable boundary before those alternatives are added.

## Pattern Check

Candidate pattern: Strategy.

Strategy does not apply yet because there is only one production projection algorithm. The pattern reference explicitly warns against adding Strategy when the algorithm is small, stable, and rarely swapped. It will apply when Codemaps adds a second projection family, such as symbol-level or domain-object projection.

## Suggested Slice

When introducing the next projection, write one public `generateCodemap` behavior test proving the selected projection preserves the existing sidecar contract. Then extract the current filesystem district map as the first projection strategy and add the new projection as the second.
