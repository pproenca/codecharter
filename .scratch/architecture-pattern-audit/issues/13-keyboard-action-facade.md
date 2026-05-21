# Decode keyboard actions outside the browser controller

Status: fixed
Labels: architecture, browser-controller, facade, tdd

## Problem

`public/app.js` was mixing DOM keyboard event details, current selection state, and map/annotation action semantics in the same controller handlers. That made keyboard behavior harder to exercise through public tests and kept adding small conditionals to an already large browser orchestration module.

## Pattern Check

Facade applies narrowly: the app controller needs a simple operation that turns keyboard event/context data into a map or annotation action intent, while the controller keeps ownership of DOM effects and side effects.

Command was considered and rejected. The current behavior does not need undo/redo, queueing, scheduling, replay, logging, serialization, or operation identity. Plain exported functions are enough.

## TDD Slice

Added a public `render-model` behavior test for decoding canvas and document keyboard actions, then moved the decision logic into `canvasKeyboardAction`, `documentKeyboardAction`, and `isSpaceKeyEvent`.

## Verification

- `node --test test/render-model.test.js`

