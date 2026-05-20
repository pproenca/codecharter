import test from "node:test";
import assert from "node:assert/strict";
import { createMapAnnotation, createNamedSelection, refreshPlaceResolution, resolveSelection } from "../src/selections.js";

const codemap = {
  folders: {
    src: target("src", "s12345678901", { x: 0, y: 0, width: 0.5, height: 1 }),
  },
  files: {
    "src/a.ts": target("src/a.ts", "s12345678901", { x: 0, y: 0, width: 0.25, height: 1 }),
    "src/b.ts": target("src/b.ts", "u98765432109", { x: 0.6, y: 0, width: 0.25, height: 1 }),
  },
};

test("resolves drawn selections with geohash coverage and geometry refinement", () => {
  const result = resolveSelection(codemap, {
    level: "file",
    geometry: { type: "rect", bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } },
  });

  assert.deepEqual(result.coveringSet, ["s123456"]);
  assert.deepEqual(result.resolvedTargets.map((target) => target.path), ["src/a.ts"]);
});

test("creates a named drawn selection", () => {
  const place = createNamedSelection(codemap, {
    name: "Search Area",
    level: "file",
    geometry: { type: "rect", bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } },
  });

  assert.equal(place.kind, "drawnSelection");
  assert.equal(place.name, "Search Area");
  assert.equal(place.resolvedTargets.length, 1);
});

test("creates map annotations with a Codex-ready spatial prompt", () => {
  const annotation = createMapAnnotation(codemap, {
    name: "Search review",
    comment: "hey explore this area",
    level: "file",
    geometry: { type: "rect", bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } },
  });

  assert.equal(annotation.kind, "mapAnnotation");
  assert.equal(annotation.comment, "hey explore this area");
  assert.equal(annotation.deepLink, `codemap://annotation/${annotation.id}`);
  assert.equal(annotation.browserHash, `#/annotation/${annotation.id}`);
  assert.equal(annotation.resolvedTargets.length, 1);
  assert.match(annotation.codexPrompt, /Explore codemap annotation \(codemap:\/\/annotation\//);
  assert.match(annotation.codexPrompt, /codemap:\/\/annotation\//);
  assert.match(annotation.codexPrompt, /#\/annotation\//);
  assert.match(annotation.codexPrompt, /src\/a\.ts/);
  assert.match(annotation.codexPrompt, /hey explore this area/);
});

test("derives map annotation labels from comments when no title is provided", () => {
  const annotation = createMapAnnotation(codemap, {
    comment: "Review the spatial picker\nIt should copy a link.",
    level: "file",
    geometry: { type: "rect", bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } },
  });

  assert.equal(annotation.name, "Review the spatial picker");
  assert.equal(annotation.comment, "Review the spatial picker\nIt should copy a link.");
  assert.match(annotation.codexPrompt, /User note: Review the spatial picker/);
});

test("refreshes map annotations against current geometry without changing identity", () => {
  const annotation = createMapAnnotation(codemap, {
    id: "annotation-1",
    name: "Search review",
    level: "file",
    geometry: { type: "rect", bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } },
  });
  const nextMap = {
    ...codemap,
    files: {
      ...codemap.files,
      "src/c.ts": target("src/c.ts", "s99999999999", { x: 0.15, y: 0.15, width: 0.05, height: 0.05 }),
    },
  };

  const refreshed = refreshPlaceResolution(nextMap, annotation);

  assert.equal(refreshed.id, "annotation-1");
  assert.deepEqual(refreshed.resolvedTargets.map((target) => target.path), ["src/a.ts", "src/c.ts"]);
  assert.match(refreshed.codexPrompt, /src\/c\.ts/);
});

test("resolves detailed drawn selections to line coordinates", () => {
  const result = resolveSelection(codemap, {
    level: "lineRange",
    geometry: { type: "rect", bounds: { x: 0.05, y: 0.1, width: 0.1, height: 0.2 } },
  });

  assert.equal(result.resolvedTargets.length, 1);
  assert.equal(result.resolvedTargets[0].targetType, "lineRange");
  assert.deepEqual(result.resolvedTargets[0].lineRange, { start: 2, end: 3 });
  assert.equal(result.resolvedTargets[0].address.targetType, "lineRange");
  assert.equal(result.coveringSet[0].length, 12);
});

test("resolves token-level drawn selections to line and column coordinates", () => {
  const result = resolveSelection(codemap, {
    level: "tokenRange",
    geometry: { type: "rect", bounds: { x: 0.05, y: 0.1, width: 0.05, height: 0.2 } },
  });

  assert.equal(result.resolvedTargets.length, 1);
  assert.equal(result.resolvedTargets[0].targetType, "tokenRange");
  assert.deepEqual(result.resolvedTargets[0].lineRange, { start: 2, end: 3 });
  assert.deepEqual(result.resolvedTargets[0].tokenRange, { start: 5, end: 8 });
  assert.equal(result.resolvedTargets[0].address.targetType, "tokenRange");
});

function target(path, geohash, bounds) {
  return {
    path,
    name: path.split("/").at(-1),
    bounds,
    geo: { geohash, lat: 0, lon: 0 },
    lineCount: 10,
    maxLineLength: 20,
    weight: 10,
  };
}
