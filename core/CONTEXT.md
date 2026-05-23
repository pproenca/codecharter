# Core Context

`@codecharter/core` is the engine package. It owns deterministic map generation,
geohash addressing, address resolution, selections, named places, source access,
activity ingestion, setup helpers, the CLI, and the localhost HTTP API.

## Architecture

- `core/src/main/geohash.ts`: code-plane to geohash projection and geohash
  decode/encode kernel.
- `core/src/main/levels.ts`: shared Map Level to geohash precision table.
- `core/src/main/scan.ts`, `extensions.ts`: gitignore-aware Code File
  discovery.
- `core/src/main/tree.ts`, `district-layout.ts`, `treemap.ts`,
  `stability.ts`: filesystem district layout and incremental stability.
- `core/src/main/generator.ts`: scan -> tree -> layout -> stabilize ->
  serialize pipeline for `.codecharter/codecharter.json`.
- `core/src/main/resolver.ts`, `line-coordinate.ts`: conversion from paths and
  line/token ranges to Map Addresses.
- `core/src/main/selections.ts`, `overlaps.ts`: drawn selections, annotations,
  named addresses, covering sets, and overlap detection.
- `core/src/main/server.ts`: hardened localhost static server and JSON API over
  map, tiles, source, named places, selections, and activity.
- `core/src/main/activity*.ts`, `codex-hook.ts`: best-effort activity event
  normalization, archive flushing, change-range extraction, and Codex hook
  integration.
- `core/src/main/init.ts`, `local-git-exclude.ts`: project provisioning,
  config, hook, skill, and git-exclude setup.
- `core/bin/codemap.mts`: CLI wiring over the core public barrel.

## Core Language

**Generated Codemap**:
The versioned JSON object produced by `generateCodemap`. It includes projection
metadata, map levels, code-plane descriptor, folders, and files.
_Avoid_: arbitrary JSON dump

**Projection Contract**:
The tuple of projection type, layout version, map order, inclusion rule, area
weight, tile addressing, and code-plane transform. If this contract changes,
previous coordinates may not be reusable.
_Avoid_: implementation detail

**Filesystem District Map**:
The current projection type. It uses folder structure as the first geography
signal and places children as bounded weighted districts.
_Avoid_: graph layout, semantic clustering

**Area Weight**:
The numeric weight used by layout to size map areas. Current generation uses
source-size-derived weight with a structural floor.
_Avoid_: visual importance

**Previous Codemap Layout**:
The subset of a prior Map Sidecar used by `stabilizeTreeLayout` to preserve
existing folder and file bounds.
_Avoid_: cache

**Sparse Root Reuse Heuristic**:
The guard in `generator.ts` that rejects previous root reuse when obsolete or
underoccupied root geography would make the map misleading.
_Avoid_: cosmetic cleanup

**Address Resolver**:
The stable API that turns a path and optional line/token range into a Resolved
Address. External tools should use this instead of reconstructing geometry.
_Avoid_: renderer helper

**Resolved Address**:
The core representation of a located target, including level, target type, path,
geohash, Deep Link, breadcrumb, bounds, geo coordinate, optional ranges, and
optional fragments.
_Avoid_: search result

**Activity Store**:
The memory-backed store that accepts activity events, returns snapshots, and
flushes archive candidates without blocking the request path.
_Avoid_: durable queue

**Activity Watcher**:
The dev-mode producer that polls git status and diffs, resolves changed files
or ranges, and posts best-effort activity events.
_Avoid_: filesystem watcher guarantee

**Hardened Localhost Server**:
The HTTP server that serves the viewer and API while enforcing localhost host
allowlisting, body limits, codemap validation, and path containment.
_Avoid_: production multi-user server

**CodeCharter Init**:
The provisioning flow that writes local config, generated-map ignores, Codex
adapter assets, hooks, and package metadata.
_Avoid_: one-time migration only

## Rules

- Import from `core/src/main/index.ts` for public CLI/package wiring unless a
  module-internal dependency needs a narrower local import.
- Preserve byte-for-byte behavior called out in transformation notes unless an
  ADR or explicit issue says to change it.
- Keep geohash math deterministic: longitude encodes first, the geohash base32
  alphabet is fixed, and edge handling is part of the contract.
- Treat malformed activity or unmapped paths as droppable telemetry, not fatal
  workflow failures.
- Keep server security constraints explicit when touching routes or file access.
- Prefer adding focused tests in `core/src/test/` for core behavior changes.
