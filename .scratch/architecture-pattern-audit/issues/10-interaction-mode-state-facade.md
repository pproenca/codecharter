Title: Keep interaction mode UI derivation outside the app controller
Status: fixed
Labels: architecture, follow-up

## Problem

`public/app.js` derived toolbar pressed states and canvas interaction classes directly from `drawing`, `panning`, `spacePanning`, and `dragging` flags. That spread interaction-state interpretation through the browser controller and made pointer mode behavior hard to verify without DOM setup.

## Pattern Check

Candidate patterns: State, Facade.

State was considered because the controller has mode-dependent behavior, but the full State pattern is not justified yet: this slice is a small derived view state, not a large workflow whose methods all branch on the same status field. The State reference's "pure data-driven state table is simpler" warning applies. A narrow Facade applies because the controller needs one simple operation that hides the interaction flag interpretation while leaving transitions and DOM effects in the app.

## Progress

Added `interactionModeUiState` to `public/render-model.js` with public behavior coverage for select, draw, pan, and space-pan UI state. `public/app.js` now delegates toolbar/canvas mode derivation to that helper.
