# 24. Browser Search Navigation Facade

Status: fixed

## Gap

`searchMap` used `mapSearchMatch` for lookup, but still interpreted every match kind in the browser controller. That mixed search/linking policy with map navigation, annotation selection, file readability zoom, folder inspection, and result-message effects.

## Pattern Check

- Pattern considered: Facade.
- When to use: client code orchestrates several subsystem operations and needs a simpler interface. Here search match interpretation is the policy boundary; browser effects can remain in handlers.
- When not to use: skip if the subsystem is already simple or if the caller needs fine-grained control. This branch covered named places, annotations, files, folders, and no-match behavior, so the controller benefited from a small intent facade.
- Nearby pattern rejected: Command. Search actions are not queued, undoable, scheduled, or recorded as first-class requests.

## Fix

Added `mapSearchAction(match)` in `public/render-model.js` and routed `public/app.js` search submission through `MAP_SEARCH_ACTION_HANDLERS`.

## Public Behavior Test

`test/render-model.test.js` now verifies that search matches derive navigation actions for no match, annotation, named place, file, and folder results without binding the behavior to browser effects.

## Verification

- `node --test --test-name-pattern "map search actions" test/render-model.test.js`
- `node --test test/render-model.test.js`
