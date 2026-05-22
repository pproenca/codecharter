# Geohash map levels

CodeCharter will use one geohash-based Map Level table for tile loading, Map Addresses, Drawn Selection covering sets, Named Places, and Agent Positions. The first levels are `world` at geohash length 1, `region` at length 2, `folder` at length 4, `file` at length 7, `code` at length 10, and `lineRange` at length 12 plus an explicit line range.

## Considered Options

- One geohash prefix table used everywhere.
- Separate slippy-map tile coordinates for rendering and geohashes for semantic addresses.
- Ad-hoc precision choices per feature.

## Consequences

The system has one spatial addressing spine, which keeps the algorithm and human navigation model easier to reason about. If rendering scale later requires another cache layout, it should be derived from these geohash levels rather than replacing them as the canonical map levels.
