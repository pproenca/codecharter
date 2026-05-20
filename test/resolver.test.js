import test from "node:test";
import assert from "node:assert/strict";
import { resolveAddress } from "../src/resolver.js";

const codemap = {
  version: 1,
  mapLevels: { world: 1, region: 2, folder: 4, file: 7, code: 10, lineRange: 12, tokenRange: 12 },
  folders: {
    src: {
      path: "src",
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      geo: { lat: 0, lon: 0, geohash: "s00000000000" },
    },
  },
  files: {
    "src/app.ts": {
      path: "src/app.ts",
      bounds: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
      geo: { lat: 0, lon: 0, geohash: "s00000000000" },
      lineCount: 100,
      maxLineLength: 80,
    },
  },
};

test("resolves a file path to a file-level map address", () => {
  const address = resolveAddress(codemap, { path: "./src/app.ts" });

  assert.equal(address.level, "file");
  assert.equal(address.targetType, "file");
  assert.equal(address.geohash, "s000000");
  assert.equal(address.deepLink, "codemap://file/s000000?path=src%2Fapp.ts");
  assert.equal(address.breadcrumb, "src > app.ts");
});

test("resolves a file path and lines to a lineRange-level map address", () => {
  const address = resolveAddress(codemap, { path: "src/app.ts", lineStart: 10, lineEnd: 20 });

  assert.equal(address.level, "lineRange");
  assert.equal(address.targetType, "lineRange");
  assert.equal(address.lineRange.start, 10);
  assert.equal(address.lineRange.end, 20);
  assert.equal(address.deepLink.includes("lines=10-20"), true);
  assert.equal(address.bounds.y, 0.295);
  assert.equal(address.bounds.height, 0.055);
});

test("resolves changed token columns into a narrower code tissue address", () => {
  const address = resolveAddress(codemap, {
    path: "src/app.ts",
    lineStart: 10,
    lineEnd: 20,
    columnStart: 9,
    columnEnd: 24,
  });

  assert.equal(address.level, "tokenRange");
  assert.equal(address.targetType, "tokenRange");
  assert.deepEqual(address.lineRange, { start: 10, end: 20 });
  assert.deepEqual(address.tokenRange, { start: 9, end: 24 });
  assert.equal(address.deepLink.includes("columns=9-24"), true);
  assert.equal(address.bounds.x, 0.3);
  assert.equal(address.bounds.width, 0.1);
});

test("resolves token fragments without placing the anchor in whitespace between lines", () => {
  const address = resolveAddress(codemap, {
    path: "src/app.ts",
    lineStart: 10,
    lineEnd: 20,
    columnStart: 1,
    columnEnd: 40,
    fragments: [
      { lineStart: 10, lineEnd: 10, columnStart: 1, columnEnd: 8 },
      { lineStart: 20, lineEnd: 20, columnStart: 32, columnEnd: 40 },
    ],
  });

  assert.equal(address.targetType, "tokenRange");
  assert.equal(address.geohash, address.fragments[0].geohash);
  assert.deepEqual(address.coveringSet, address.fragments.map((fragment) => fragment.geohash).sort());
  assert.equal(address.fragments.length, 2);
  assert.equal(address.fragments.every((fragment) => fragment.targetType === "tokenRange"), true);
  assert.equal(address.fragments.every((fragment) => typeof fragment.geohash === "string"), true);
  assert.equal(address.fragments.every((fragment) => fragment.geo === undefined), true);
  assert.deepEqual(address.fragments[0].lineRange, { start: 10, end: 10 });
  assert.deepEqual(address.fragments[0].tokenRange, { start: 1, end: 8 });
  assert.equal(address.fragments[0].bounds.x, 0.25);
  assert.equal(address.fragments[0].bounds.width, 0.05);
  assert.deepEqual(address.fragments[1].lineRange, { start: 20, end: 20 });
  assert.deepEqual(address.fragments[1].tokenRange, { start: 32, end: 40 });
  assert.equal(address.fragments[1].bounds.x, 0.44375);
  assert.equal(address.fragments[1].bounds.width, 0.05625);
});

test("rejects column ranges without a line range", () => {
  assert.throws(
    () => resolveAddress(codemap, { path: "src/app.ts", columnStart: 3, columnEnd: 8 }),
    /Line must be an integer/,
  );
});
