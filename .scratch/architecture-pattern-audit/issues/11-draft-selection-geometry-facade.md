Title: Keep draft selection geometry outside the app controller
Status: ready-for-agent
Labels: architecture, follow-up

## Problem

`public/app.js` calculated draft selection rectangles and screen-pixel usability directly in pointer handlers. That mixed domain geometry with DOM event handling and made drawn-selection behavior harder to verify without a canvas.

## Pattern Check

Candidate patterns: Command, Facade.

Command was rejected because drawing a draft rectangle is not an undoable, queued, or replayable operation here; the pattern reference says a plain function is enough when there is no undo, queueing, or logging need. Facade applies narrowly because pointer handlers need a simple operation over world-space drag points and viewport-scale usability rules while the controller still owns events and rendering.

## Progress

Added `draftSelectionFromDrag` and `isUsableDraftSelection` to `public/render-model.js` with public behavior coverage for rectangle derivation and screen-pixel minimums. `public/app.js` now delegates draft selection geometry and usability checks to those helpers.
