Title: Resolve browser search matches outside the app controller
Status: ready-for-agent
Labels: architecture, follow-up

## Problem

Browser search mixed query normalization, named-place priority, file and folder matching, geohash-prefix matching, result labels, and UI effects inside `public/app.js`. That made search/linking semantics difficult to test without the full browser controller.

## Pattern Check

Candidate patterns: Chain of Responsibility, Facade.

Chain of Responsibility was rejected because the search order is fixed and small; the pattern reference warns that a direct sequence is clearer in that case. Facade applies because the controller needs one simple search-resolution operation over named places and sidecar map targets, while the UI remains responsible for camera movement, selection, and rendering.

## Progress

Added `mapSearchMatch` to `public/render-model.js` with public behavior coverage for annotation priority and folder geohash-prefix matching. `public/app.js` now uses that facade for search-match semantics and keeps only the UI effects in the controller.
