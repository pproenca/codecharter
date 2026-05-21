# Derive source panel state in the render model

Status: fixed
Labels: architecture, source-context, browser-controller, facade, tdd

## Problem

`public/app.js` formatted source panel title/output in multiple browser flows: hash-route file focus, map-click file focus, and activity selection. That duplicated source-context preservation rules such as `path · deepLink`, formatted source lines, fallback activity text, and scroll reset behavior.

## Pattern Check

Facade applies narrowly: the browser controller needs one simple source-panel view model while the render model owns source-context presentation rules.

Strategy and Command were rejected. There are no interchangeable algorithms or queued/undoable requests; this is presentation derivation over a small source-context subsystem.

## TDD Slice

Added a public `render-model` behavior test for source-backed code context and activity fallback output, then introduced `sourcePanelState`. `public/app.js` now uses that state for route, map-click, and activity source panels.

## Verification

- `node --test --test-name-pattern "source panel state" test/render-model.test.js`

