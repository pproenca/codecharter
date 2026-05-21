# 27. Browser Hover Label Facade

## Gap

`public/app.js` formatted hover labels by branching on map target kind. That kept user-facing map navigation feedback policy in the browser controller instead of the render model.

## Pattern Check

- Pattern considered: Facade.
- When to use: client code coordinates several target representations and needs a simple interface. Here the target representations are annotations, activity markers, and ordinary map targets.
- When not to use: skip if the subsystem is already simple. This is intentionally a narrow facade because the branch is small; it is still useful because hover text is user-visible navigation feedback and shares activity actor/state formatting with the map render model.
- Nearby pattern rejected: Strategy. Hover labels are not runtime-swappable algorithms; they are target-display policy.

## Fix

Added `mapHoverLabel(hit)` and exported `activityActorLabel(event)` from `public/render-model.js`. `public/app.js` now uses `mapHoverLabel` for hover feedback and imports `activityActorLabel` instead of keeping a duplicate local helper.

## Public Behavior Test

`test/render-model.test.js` verifies hover labels for annotations, activity markers, and file targets without depending on browser state.

## Verification

- `node --test --test-name-pattern "hover labels" test/render-model.test.js`
- `node --test test/render-model.test.js`
