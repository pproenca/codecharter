# 23. Browser Map Target Selection Facade

## Gap

`selectMapTarget` interpreted raw hit targets directly in the browser controller, branching across empty space, annotations, activity markers, folders, and files before mixing in source-panel loading. That made map navigation policy and source-context preservation harder to test outside DOM effects.

## Pattern Check

- Pattern considered: Facade.
- When to use: a client is tangled with subsystem decision logic and needs a simpler interface. Here the controller needed a target-selection intent instead of target-kind branching.
- When not to use: skip if the branch is a one-off wrapper or if the caller needs all subsystem details. This does not apply because selection crosses navigation, annotation focus, activity focus, folder inspection, and file source-context loading.
- Nearby pattern rejected: Command. There is no undo/redo, queueing, scheduling, or macro recording requirement.

## Fix

Added `mapTargetSelectionAction(hit)` in `public/render-model.js` and routed `public/app.js` selection through `MAP_TARGET_SELECTION_HANDLERS`.

## Public Behavior Test

`test/render-model.test.js` verifies that raw map hits derive selection actions for empty space, annotation, activity, folder, and file targets without binding the behavior to source-panel or browser effects.

## Verification

- `node --test --test-name-pattern "map target selection actions" test/render-model.test.js`
- `node --test test/render-model.test.js`
