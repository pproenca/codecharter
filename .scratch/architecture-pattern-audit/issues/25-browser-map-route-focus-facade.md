# 25. Browser Map Route Focus Facade

## Gap

`focusMapRoute` resolved a hash route target, then interpreted the target kind directly in the browser controller. That mixed geohash-prefix deep-link navigation with file source-panel loading and folder inspection effects.

## Pattern Check

- Pattern considered: Facade.
- When to use: a client coordinates multiple subsystem operations and needs a simpler entry point. Here route target interpretation is the policy boundary for file and folder focus.
- When not to use: skip if the subsystem is already simple or the caller needs fine-grained control. This branch controls different zoom framing and source-context behavior, so an intent facade is useful without hiding browser effects.
- Nearby pattern rejected: Strategy. Route focus is not swapping algorithms at runtime; it is deriving a navigation intent from a resolved target.

## Geohash Navigation Check

The geohash navigation rule says deep links should keep geohash prefix/state as the route and derive focus from that state. The fix keeps `mapRouteTarget` as the prefix/path resolver and adds a small route-focus action over the resolved target.

## Fix

Added `mapRouteFocusAction(target)` in `public/render-model.js` and routed `public/app.js` map route focusing through `MAP_ROUTE_FOCUS_HANDLERS`.

## Public Behavior Test

`test/render-model.test.js` now verifies that resolved map route targets derive file and folder focus actions with the expected zoom padding without binding the behavior to source-panel effects.

## Verification

- `node --test --test-name-pattern "map route focus actions" test/render-model.test.js`
- `node --test test/render-model.test.js`
