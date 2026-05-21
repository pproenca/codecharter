Title: Resolve browser map route targets outside the app controller
Status: fixed
Labels: architecture, follow-up

## Problem

Browser map-route focusing kept path metadata lookup, ordinary path normalization, geohash-prefix lookup, and target typing as private helpers inside `public/app.js`. That made the app controller responsible for route semantics in addition to UI effects.

## Pattern Check

Candidate pattern: Facade.

Facade applies because route focusing needs a simple entry point over several route-targeting details: route params, sidecar map keys, geohash prefixes, and file/folder target shapes. The implementation deliberately stays narrow to avoid the pattern's god-object warning; it extracts only target resolution and leaves camera movement, DOM updates, and source loading in the app controller.

## Progress

Added `mapRouteTarget` to `public/render-model.js` with public behavior coverage for path metadata and geohash-prefix route targeting. `public/app.js` now asks that facade for the route target instead of owning the lookup helpers directly.
