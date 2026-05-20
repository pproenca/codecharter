# Codemaps

Codemaps turns a codebase into a navigable 2D map.

The goal is to project source code into one large spatial plane, assign geohashes to areas of that plane, and use those geohash prefixes to represent business domains, features, modules, and smaller implementation regions. The experience should feel closer to navigating Google Maps than browsing a file tree.

## Working Direction

- Treat code structure as geography.
- Use deterministic projection so the same codebase produces stable coordinates.
- Use geohash prefixes as hierarchical regions.
- Make domain and feature boundaries visible, searchable, and linkable.
- Preserve enough source context that navigation can move from map region to concrete code.

## Agent Rules

- When design decisions are unclear, use the `grill-me` skill: ask one question at a time and include a recommended answer.
- For spatial indexing, geohashing, map navigation, or codebase-as-map work, use the `geohash-spatial-code-maps` skill.
- Prefer exploring the codebase before asking questions that local context can answer.
- Keep early implementation simple and prototype-driven until the core projection model is proven.

## First Design Question

What is the first stable unit on the map: file, symbol, directory, commit, or domain object?

Recommended answer: start with files. Files are easy to extract, stable enough for a first projection, and can later expand into symbols or domain objects without blocking the prototype.
