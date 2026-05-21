Title: Replace API route cascade with an explicit route dispatch table
Status: needs-triage
Labels: architecture, follow-up

## Problem

`src/server.js` keeps all API routing in one long `handleApi` conditional cascade. It is still understandable today, but new map layers, source-context endpoints, and naming/search endpoints will keep adding branches to the same function.

## Pattern Check

Candidate patterns: Chain of Responsibility, Command, Facade.

Chain of Responsibility does not fully apply yet because the route order is fixed and the handlers are not a dynamic middleware pipeline. Command does not fully apply because routes are not queued, replayed, undone, or logged as first-class requests. Facade partially applies at the server boundary, but the subsystem is not duplicated across callers.

## Suggested Slice

Introduce a small route table keyed by method and path/prefix. Keep `startServer` and HTTP behavior unchanged. Add one public server API test for a dynamic route, then move one route at a time while green.
