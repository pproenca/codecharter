# Derive browser hash-route focus intent outside the controller

Status: fixed
Labels: architecture, browser-controller, map-navigation, facade, tdd

## Problem

`public/app.js` still interpreted parsed browser hash route shapes directly inside `applyHashRoute`, coupling route parsing details to effectful focus handlers for annotations, drawn selections, and map targets.

## Pattern Check

Facade applies narrowly: the browser controller needs a simple focus intent for a parsed route and map-loaded state, while route effect handlers stay in the controller.

Class-based Strategy was rejected. The controller does not need swappable route algorithms or independent strategy objects; a small intent facade plus handler table removes the boundary coupling without adding lifecycle or object indirection.

## TDD Slice

Added a public `render-model` behavior test for annotation, selection, map, missing-map, and unknown route focus intents. Then introduced `hashRouteFocusIntent` and updated `applyHashRoute` to dispatch through `HASH_ROUTE_FOCUS_HANDLERS`.

## Verification

- `node --test --test-name-pattern "hash route focus intents" test/render-model.test.js`
- `node --test test/render-model.test.js`
- `pnpm test`

