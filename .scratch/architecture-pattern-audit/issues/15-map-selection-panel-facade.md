# Derive map selection panel state outside the browser controller

Status: fixed
Labels: architecture, browser-controller, map-navigation, facade, tdd

## Problem

`public/app.js` still formatted empty, folder, and file selection panel state inline inside `selectMapTarget`, while other map navigation paths needed the same folder display vocabulary. That kept browser DOM orchestration coupled to map target presentation rules.

## Pattern Check

Facade applies narrowly: the browser controller needs a simple map-selection presentation interface, while the render model owns target labels and inspector/source panel copy.

Command and Strategy were rejected. There is no request queue, undo/replay, or interchangeable navigation algorithm here; the controller only needs a derived view model.

## TDD Slice

Added a public `render-model` behavior test for empty, folder, and file selection panel state, then introduced `mapSelectionPanel` and `folderDisplayName`. `public/app.js` now consumes those helpers instead of formatting the panel inline.

## Verification

- `node --test --test-name-pattern "map selection panel" test/render-model.test.js`

