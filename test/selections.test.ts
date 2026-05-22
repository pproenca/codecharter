import test from "node:test";
import assert from "node:assert/strict";
import { createMapAnnotation, createNamedSelection, refreshPlaceResolution, resolveSelection } from "../src/selections.ts";

const codemap = {
  folders: {
    "": target("", "s00000000000", { x: 0, y: 0, width: 1, height: 1 }),
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
  assert.deepEqual(Object.keys(result.spatialFrame.corners), ["northWest", "northEast", "southWest", "southEast"]);
  assert.equal(result.spatialFrame.corners.northWest.length, 7);
});

test("resolves selections with clamped bounds, unique coverage, and path-sorted targets", () => {
  const map = {
    folders: {},
    files: {
      "src/z.ts": target("src/z.ts", "s12345678901", { x: 0.05, y: 0.05, width: 0.2, height: 0.2 }),
      "src/a.ts": target("src/a.ts", "s12345678999", { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }),
      "src/outside.ts": target("src/outside.ts", "u98765432109", { x: 0.8, y: 0.8, width: 0.1, height: 0.1 }),
    },
  };

  const result = resolveSelection(map, {
    level: "file",
    geometry: { type: "rect", bounds: { x: -0.1, y: -0.1, width: 0.5, height: 0.5 } },
  });

  assert.deepEqual(result.geometry.bounds, { x: 0, y: 0, width: 0.4, height: 0.4 });
  assert.deepEqual(result.coveringSet, ["s123456"]);
  assert.deepEqual(result.resolvedTargets.map((target) => target.path), ["src/a.ts", "src/z.ts"]);
});

test("resolves world-level selections to the root code map region", () => {
  const result = resolveSelection(codemap, {
    level: "world",
    geometry: { type: "rect", bounds: { x: 0, y: 0, width: 1, height: 1 } },
  });

  assert.deepEqual(result.coveringSet, ["s"]);
  assert.deepEqual(result.resolvedTargets.map((target) => target.path), [""]);
  assert.equal(required(result.resolvedTargets[0]).targetType, "folder");
});

test("resolves region selections to non-root folders", () => {
  const result = resolveSelection(codemap, {
    level: "region",
    geometry: { type: "rect", bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } },
  });

  assert.deepEqual(result.resolvedTargets.map((target) => target.path), ["src"]);
  assert.equal(required(result.resolvedTargets[0]).targetType, "folder");
});

test("rejects degenerate drawn selections before resolving map targets", () => {
  assert.throws(
    () => resolveSelection(codemap, {
      level: "file",
      geometry: { type: "rect", bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0 } },
    }),
    /non-zero area/,
  );
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
  assert.equal(annotation.deepLink, `codecharter://annotation/${annotation.id}`);
  assert.equal(annotation.browserHash, `#/annotation/${annotation.id}`);
  assert.equal(annotation.resolvedTargets.length, 1);
  assert.match(annotation.codexPrompt, /CodeCharter annotation: codecharter:\/\/annotation\//);
  assert.match(annotation.codexPrompt, /Resolve: npx --yes codecharter@latest --json resolve "codecharter:\/\/annotation\//);
  assert.match(annotation.codexPrompt, /Note: hey explore this area/);
  assert.doesNotMatch(annotation.codexPrompt, /Targets:/);
  assert.doesNotMatch(annotation.codexPrompt, /CLI: codecharter/);
  assert.doesNotMatch(annotation.codexPrompt, /Fallback:/);
  assert.doesNotMatch(annotation.codexPrompt, /Do not use browser automation unless asked/);
  assert.doesNotMatch(annotation.codexPrompt, /#\/annotation\//);
  assert.doesNotMatch(annotation.codexPrompt, /Spatial frame/);
  assert.doesNotMatch(annotation.codexPrompt, /Corner geohashes/);
  assert.doesNotMatch(annotation.codexPrompt, /Geohash coverage/);
  assert.doesNotMatch(annotation.codexPrompt, /Resolved targets/);
  assert.doesNotMatch(annotation.codexPrompt, /src\/a\.ts/);
});

test("derives map annotation labels from comments when no title is provided", () => {
  const annotation = createMapAnnotation(codemap, {
    comment: "Review the spatial picker\nIt should copy a link.",
    level: "file",
    geometry: { type: "rect", bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } },
  });

  assert.equal(annotation.name, "Review the spatial picker");
  assert.equal(annotation.comment, "Review the spatial picker\nIt should copy a link.");
  assert.match(annotation.codexPrompt, /Note: Review the spatial picker/);
});

test("derives map annotation labels from the first nonblank comment line", () => {
  const annotation = createMapAnnotation(codemap, {
    comment: "\n\n  Review later lines\nSecond line",
    level: "file",
    geometry: { type: "rect", bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } },
  });

  assert.equal(annotation.name, "Review later lines");
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
  assert.match(refreshed.codexPrompt, /Resolve: npx --yes codecharter@latest --json resolve "codecharter:\/\/annotation\/annotation-1"/);
  assert.doesNotMatch(refreshed.codexPrompt, /Targets:/);
  assert.doesNotMatch(refreshed.codexPrompt, /s123456/);
  assert.doesNotMatch(refreshed.codexPrompt, /s999999/);
});

test("keeps large annotation prompts compact by not dumping resolved target geohashes", () => {
  const files = Object.fromEntries(Array.from({ length: 40 }, (_, index) => {
    const width = 1 / 40;
    return [
      `src/file-${index}.ts`,
      target(`src/file-${index}.ts`, `s${index.toString().padStart(11, "0")}`, { x: index * width, y: 0, width, height: 1 }),
    ];
  }));
  const annotation = createMapAnnotation({ folders: {}, files }, {
    comment: "scan this wide area",
    level: "file",
    geometry: { type: "rect", bounds: { x: 0, y: 0, width: 1, height: 1 } },
  });

  assert.equal(annotation.resolvedTargets.length, 40);
  assert.match(annotation.codexPrompt, /Resolve: npx --yes codecharter@latest --json resolve "codecharter:\/\/annotation\//);
  assert.doesNotMatch(annotation.codexPrompt, /Targets:/);
  assert.doesNotMatch(annotation.codexPrompt, /Corner geohashes:/);
  assert.doesNotMatch(annotation.codexPrompt, /s00000000000/);
  assert.doesNotMatch(annotation.codexPrompt, /src\/file-0\.ts/);
  assert.ok(annotation.codexPrompt.length < 500);
});

test("resolves detailed drawn selections to line coordinates", () => {
  const result = resolveSelection(codemap, {
    level: "lineRange",
    geometry: { type: "rect", bounds: { x: 0.05, y: 0.1, width: 0.1, height: 0.2 } },
  });

  assert.equal(result.resolvedTargets.length, 1);
  const target = required(result.resolvedTargets[0]);
  assert.equal(target.targetType, "lineRange");
  assert.deepEqual(target.lineRange, { start: 2, end: 3 });
  assert.equal(required(target.address).targetType, "lineRange");
  assert.equal(required(result.coveringSet[0]).length, 12);
});

test("resolves token-level drawn selections to line and column coordinates", () => {
  const result = resolveSelection(codemap, {
    level: "tokenRange",
    geometry: { type: "rect", bounds: { x: 0.05, y: 0.1, width: 0.05, height: 0.2 } },
  });

  assert.equal(result.resolvedTargets.length, 1);
  const target = required(result.resolvedTargets[0]);
  assert.equal(target.targetType, "tokenRange");
  assert.deepEqual(target.lineRange, { start: 2, end: 3 });
  assert.deepEqual(target.tokenRange, { start: 5, end: 8 });
  assert.equal(required(target.address).targetType, "tokenRange");
});

function target(path: string, geohash: string, bounds: { x: number; y: number; width: number; height: number }) {
  return {
    path,
    name: path.split("/").at(-1) ?? path,
    bounds,
    geo: { geohash, lat: 0, lon: 0 },
    lineCount: 10,
    maxLineLength: 20,
    weight: 10,
  };
}

function required<T>(value: T | null | undefined): T {
  assert.ok(value);
  return value;
}
