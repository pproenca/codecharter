# 22. Browser Double-Click Navigation Facade

Status: fixed

## Gap

`onCanvasDoubleClick` mixed hit-type interpretation with browser effects. That kept map navigation policy in the controller and made each new map target kind another controller branch.

## Pattern Check

- Pattern considered: Facade.
- When to use: client code is tangled with a subsystem's decision logic and needs a simple interface over it. Here the subsystem is map hit interpretation for double-click navigation.
- When not to use: skip if the logic is trivial or if the facade only renames one call. This branch already covered annotation, folder, file, empty-space, and now activity targets, so a tested intent facade is justified.
- Nearby pattern rejected: Command. There is no undo, queueing, scheduling, or macro recording requirement; the controller still owns browser effects.

## Fix

Added `doubleClickMapAction(hit)` in `public/render-model.js` and routed `public/app.js` double-click handling through `DOUBLE_CLICK_ACTION_HANDLERS`.

## Public Behavior Test

`test/render-model.test.js` verifies that double-click hit targets derive navigation actions for file, folder, annotation, and activity targets without binding the test to DOM/browser effects.

## Verification

- `node --test --test-name-pattern "double-click map navigation" test/render-model.test.js`
- `node --test test/render-model.test.js`
