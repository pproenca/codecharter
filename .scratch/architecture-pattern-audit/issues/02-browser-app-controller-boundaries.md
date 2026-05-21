Title: Split browser map UI into focused interaction and rendering controllers
Status: fixed
Labels: architecture, follow-up

## Problem

`public/app.js` is a large browser controller that coordinates hash routes, camera movement, selection drawing, annotations, activity overlays, source loading, and canvas rendering. The pure render math has already been extracted to `public/render-model.js`, but the remaining UI coordination is still hard to change safely.

## Pattern Check

Candidate pattern: Mediator.

Mediator partially applies because the file is an implicit coordination hub. It is not a critical fix yet because the UI is not made of reusable components that directly reference each other, and applying a formal mediator wholesale risks creating a larger god object.

## Suggested Slice

Start with one behavior-preserving extraction around interaction mode transitions or hash-route focusing. Add public browser-facing tests around the extracted behavior through `render-model`-style pure functions where possible, then move only the corresponding controller code.

## Progress

Implemented a first focused facade slice for Source Content preservation: `public/render-model.js` now owns source-context API request construction and source-line formatting, and `public/app.js` uses that boundary from route focusing, map selection, and activity selection.
