Title: Normalize ordinary paths before resolving map addresses
Status: ready-for-agent
Labels: architecture, follow-up

## Problem

The Address Resolver and browser deep-link focusing accepted sidecar map keys more readily than ordinary path spellings. Paths such as `.` and `./src/` are normal user-facing ways to refer to the repository root and a folder, but the sidecar stores those keys as `""` and `src`.

## Pattern Check

Candidate pattern: Adapter.

Adapter applies because the boundary translates caller-facing filesystem path spellings into the Map Sidecar key interface. A class-based adapter would be unnecessary overhead, so the implementation stays as a small function.

## Progress

Implemented the first path-adapter slice in `src/resolver.js` and `public/render-model.js`. `resolveAddress` and browser `targetForPath` now normalize `.` to the root sidecar key, strip a leading `./`, convert backslashes, and strip trailing slashes.
