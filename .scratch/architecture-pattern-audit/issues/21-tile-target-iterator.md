# 21. Tile Target Iterator

## Gap

`buildTileIndex` and `getTile` each knew how to traverse the codemap's folder and file stores. That duplicated map-target traversal and let geohash tile output depend on object insertion order inside the sidecar.

## Pattern Check

- Pattern considered: Iterator.
- When to use: traversal complexity is duplicated and clients should not know whether targets live in folder or file collections.
- When not to use: skip when the data is already one plain array or there is only one traversal. This does not apply; the tile module has two public traversals over two internal collections.
- Nearby pattern rejected: Composite. The domain is tree-shaped, but the tile APIs consume the flattened sidecar stores and only need deterministic traversal, not a recursive component interface.

## Fix

Added a single sorted map-target generator used by both tile APIs. It emits folders and files as uniform serialized map targets, sorted deterministically by path within each target kind.

## Public Behavior Test

`test/tiles.test.js` now verifies that `getTile` returns tile targets in deterministic map target kind/path order even when the input sidecar objects were inserted in a different order.

## Verification

- `node --test --test-name-pattern "orders tile targets" test/tiles.test.js`
- `node --test test/tiles.test.js`
