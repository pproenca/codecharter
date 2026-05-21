# 26. Browser Selected Target Reconciliation Facade

Status: fixed

## Gap

`applyMap` refreshed the sidecar and then `public/app.js` interpreted selected target kinds directly to preserve file/folder selection against the new map. That kept source-context preservation policy in the browser controller.

## Pattern Check

- Pattern considered: Facade.
- When to use: client code coordinates subsystem details and needs a simpler interface. Here the subsystem is refreshed sidecar state plus stale selected map targets.
- When not to use: skip if the logic is too small or the caller needs fine-grained control. The logic is small, but it protects a critical behavior: keeping selected source context stable across live map refreshes while clearing removed file/folder targets.
- Nearby patterns rejected:
  - State: there is no state machine transition ownership here.
  - Observer: map refresh notification already exists; the gap is target reconciliation policy, not subscription.

## Fix

Added `reconciledSelectedTarget(codemap, target)` in `public/render-model.js` and made `public/app.js` use it when applying a refreshed map.

## Public Behavior Test

`test/render-model.test.js` verifies that refreshed sidecar entries replace stale selected file/folder targets, missing file targets clear, non-sidecar targets are preserved, and empty selection remains empty.

## Verification

- `node --test --test-name-pattern "reconciles selected" test/render-model.test.js`
- `node --test test/render-model.test.js`
