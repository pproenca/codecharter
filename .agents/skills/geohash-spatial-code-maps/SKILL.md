---
name: geohash-spatial-code-maps
description: Design or review CodeCharter spatial indexing, geohash precision, Map Levels, tile coverage, selections, and stable code-map navigation.
---

# Geohash Spatial Code Maps

Use this skill for CodeCharter work involving spatial indexing, geohashing, map
navigation, codebase-as-map design, tiles, selections, Named Places, or stable
Map Addresses.

## Read First

- `CONTEXT.md` for product-wide map language.
- `core/CONTEXT.md` for geohash, levels, generation, resolver, selections, and
  tiles.
- `viewer/CONTEXT.md` for camera, LOD, render-model, routes, activity visuals,
  and discovery fog.
- ADRs:
  - `docs/adr/0001-stable-code-map-addresses.md`
  - `docs/adr/0002-json-map-sidecar.md`
  - `docs/adr/0003-geohash-map-levels.md`
  - `docs/adr/0004-codemap-deep-links.md`

## Spatial Contracts

- CodeCharter maps the normalized Code Plane to standard geohash latitude and
  longitude internally. Do not imply the map is literal Earth geography.
- Geohash prefixes are the common spine for Map Levels, tiles, addresses,
  selections, Named Places, and activity.
- Existing places should remain stable across regeneration when the Projection
  Contract still matches.
- Repack is explicit. Do not hide address-moving layout changes inside ordinary
  regeneration.
- File is the first stable map unit. Line Coordinates and Token Ranges refine
  within a File without changing the File area.
- Covering Sets are lookup approximations. Resolution must refine against real
  map geometry before returning targets.

## Design Loop

1. Name the map concept using glossary terms.
2. Identify the canonical owner: Map Sidecar, core resolver, selection
   resolution, tile derivation, viewer render model, or activity overlay.
3. Decide whether the change affects base geography or a volatile overlay.
4. Check the Map Level/geohash precision impact.
5. Preserve deterministic ordering and stable address reuse.
6. Add focused tests for the changed contract.

## Avoid

- Separate tile coordinates as a competing semantic address system.
- Browser hash routes as canonical Map Addresses.
- Persisted activity, discovery, or render state inside the Map Sidecar.
- Path-only locators when a Map Address is required.
- Treating Token Range geometry as tokenizer-owned canonical layout.
- Recomputing expensive spatial membership in per-target draw paths.

## Proof

- Geohash math: focused tests around encode/decode, precision, and edge cases.
- Stable addresses: generation/stability tests with previous sidecars.
- Deep Links: parser/formatter tests for `codecharter://` and legacy
  `codemap://` input.
- Selections: covering-set plus geometry-refinement tests.
- Viewer navigation: route, target reconciliation, LOD, and source-panel tests.
