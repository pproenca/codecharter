Title: Reuse camera pan math for pointer drag navigation
Status: fixed
Labels: architecture, follow-up

## Problem

Wheel and keyboard panning already used the render-model camera helpers, but pointer drag panning repeated the screen-delta-to-world-view math inside `public/app.js`. That left one map-navigation path coupled to canvas dimensions and live view details in the browser controller.

## Pattern Check

Candidate patterns: Command, Facade.

Command was rejected because pointer dragging is not being queued, replayed, logged, or undone; the pattern reference warns that a plain function is better when JavaScript callbacks and direct helpers suffice. Facade applies narrowly because the controller needs one simple map-navigation operation over drag start, current screen position, viewport, and the drag's anchor view.

## Progress

Added `panViewForDrag` to `public/render-model.js` with public behavior coverage that ensures the drag uses its captured anchor view, not the live mutable view. `public/app.js` now delegates pointer-drag panning to that helper.
