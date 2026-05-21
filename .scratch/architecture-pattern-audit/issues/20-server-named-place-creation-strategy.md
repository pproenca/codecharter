# Make named-place creation explicit at the server boundary

Status: fixed
Labels: architecture, server-api, strategy, tdd

## Problem

`POST /api/named-places` treated every request whose `kind` was not `mapAddress` as a drawn selection. A request with an unknown but valid-looking `kind` could therefore be accepted and stored as a `drawnSelection`, hiding client mistakes at the API boundary.

## Pattern Check

Functional Strategy applies: named-place creation is selected at runtime from a small set of supported kinds, and the server boundary should make the supported creation variants explicit.

Factory Method was considered and rejected. There is no creator class hierarchy and no need for subclass extension; a small creator table is enough. A broad Abstract Factory would be overkill because only one product is created.

## TDD Slice

Added a public API behavior test proving unknown named-place kinds return `400` and are not persisted. Then introduced `NAMED_PLACE_CREATORS` and `createNamedPlace`, preserving the legacy default of omitted `kind` as `drawnSelection`.

## Verification

- `node --test --test-name-pattern "unknown named-place" test/server.test.js`

