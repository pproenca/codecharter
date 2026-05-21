Title: Keep annotation clipboard handoff formatting outside the app controller
Status: ready-for-agent
Labels: architecture, follow-up

## Problem

`public/app.js` assembled Codex-ready annotation clipboard text directly, combining annotation deep links, target counts, user comments, server origin, and browser share URLs. That kept source-context/link preservation rules inside the browser controller and duplicated concerns already owned by the map model and annotation domain.

## Pattern Check

Candidate pattern: Facade.

Facade applies because clipboard handoff needs one simple operation over several pieces of annotation/link context. Adapter was rejected because no incompatible interface is being translated, and Proxy was rejected because this is formatting/link orchestration rather than lifecycle control. The implementation stays narrow to avoid a broad browser app facade.

## Progress

Added `annotationClipboardText` to `public/render-model.js` with public behavior coverage for deep links, target counts, comments, server-aware CLI commands, and browser share URLs. `public/app.js` now supplies browser origin/current URL and delegates formatting to that facade.
