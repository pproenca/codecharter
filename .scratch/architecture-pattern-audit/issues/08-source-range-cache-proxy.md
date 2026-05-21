Title: Keep source-range cache lifecycle outside the app controller
Status: fixed
Labels: architecture, follow-up

## Problem

Inline source rendering in `public/app.js` owned source cache keys, cache hits, hit promotion, and LRU eviction alongside canvas drawing and request scheduling. That tangled source-context preservation with browser controller rendering details.

## Pattern Check

Candidate pattern: Proxy.

Proxy applies because the browser controls recurring access to source-range reads and adds caching and lifecycle behavior around an underlying `/api/source` service. Adapter was rejected because the interface is not being changed, and Facade was rejected because this is not simplifying a whole subsystem; it is controlling access to one cached source-read subject. The implementation stays as small pure helpers rather than a class to avoid unnecessary complexity.

## Progress

Added source-range cache helpers to `public/render-model.js` with public behavior coverage for range containment, ordinary path normalization, hit promotion, and LRU eviction. `public/app.js` now uses those helpers and reuses `sourceContextRequest` when fetching source ranges for inline rendering.
