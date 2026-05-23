import test from "node:test";
import assert from "node:assert/strict";
import { CodeRangeGeometryMapper, codeRangeGeometry, codeRangeRequestForSelection } from "../src/line-coordinate.ts";
import { AddressResolver, resolveAddress } from "../src/resolver.ts";
import { required } from "../test-support/assertions.ts";

const codemap = {
  version: 1,
  mapLevels: { world: 1, region: 2, folder: 4, file: 7, code: 10, lineRange: 12, tokenRange: 12 },
  folders: {
    "": {
      path: "",
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      geo: { lat: 0, lon: 0, geohash: "s00000000000" },
    },
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
  assert.equal(address.deepLink, "codecharter://file/s000000?path=src%2Fapp.ts");
  assert.equal(address.breadcrumb, "src > app.ts");
});

test("adapts ordinary folder path spellings to sidecar map keys", () => {
  const root = resolveAddress(codemap, { path: "." });
  const folder = resolveAddress(codemap, { path: "./src/" });

  assert.equal(root.targetType, "folder");
  assert.equal(root.path, "");
  assert.equal(root.breadcrumb, ".");
  assert.equal(folder.targetType, "folder");
  assert.equal(folder.path, "src");
  assert.equal(folder.deepLink, "codecharter://folder/s000?path=src");
});

test("resolves a file path and lines to a lineRange-level map address", () => {
  const address = resolveAddress(codemap, { path: "src/app.ts", lineStart: 10, lineEnd: 20 });

  assert.equal(address.level, "lineRange");
  assert.equal(address.targetType, "lineRange");
  const lineRange = required(address.lineRange);
  assert.equal(lineRange.start, 10);
  assert.equal(lineRange.end, 20);
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
      { columnStart: 12, columnEnd: 20 },
      { lineStart: 20, lineEnd: 20, columnStart: 32, columnEnd: 40 },
    ],
  });

  assert.equal(address.targetType, "tokenRange");
  const fragments = required(address.fragments);
  const first = required(fragments[0]);
  const second = required(fragments[1]);
  assert.equal(address.geohash, first.geohash);
  assert.deepEqual(address.coveringSet, fragments.map((fragment) => fragment.geohash).sort());
  assert.equal(fragments.length, 2);
  assert.equal(fragments.every((fragment) => fragment.targetType === "tokenRange"), true);
  assert.equal(fragments.every((fragment) => typeof fragment.geohash === "string"), true);
  assert.equal(fragments.every((fragment) => fragment.geo === undefined), true);
  assert.deepEqual(first.lineRange, { start: 10, end: 10 });
  assert.deepEqual(first.tokenRange, { start: 1, end: 8 });
  assert.equal(first.bounds.x, 0.25);
  assert.equal(first.bounds.width, 0.05);
  assert.deepEqual(second.lineRange, { start: 20, end: 20 });
  assert.deepEqual(second.tokenRange, { start: 32, end: 40 });
  assert.equal(second.bounds.x, 0.44375);
  assert.equal(second.bounds.width, 0.05625);
});

test("rejects column ranges without a line range", () => {
  assert.throws(
    () => resolveAddress(codemap, { path: "src/app.ts", columnStart: 3, columnEnd: 8 }),
    /Line must be an integer/,
  );
});

test("AddressResolver keeps the exported class facade behaviour", () => {
  const resolver = new AddressResolver(codemap);
  const request = { path: "src/app.ts", lineStart: 10, lineEnd: 20, columnStart: 9, columnEnd: 24 };

  assert.deepEqual(resolver.resolve(request), resolveAddress(codemap, request));
  assert.deepEqual(resolver.resolveFile(codemap.files["src/app.ts"], request), resolveAddress(codemap, request));
  assert.deepEqual(resolver.resolveFolder(codemap.folders.src), resolveAddress(codemap, { path: "src" }));
});

test("CodeRangeGeometryMapper keeps the exported class facade behaviour", () => {
  const file = codemap.files["src/app.ts"];
  const mapper = new CodeRangeGeometryMapper();
  const request = {
    lineStart: 10,
    lineEnd: 20,
    columnStart: 9,
    columnEnd: 24,
    fragments: [
      { lineStart: 10, lineEnd: 10, columnStart: 1, columnEnd: 8 },
      { lineStart: 20, lineEnd: 20, columnStart: 32, columnEnd: 40 },
    ],
  };
  const selectionBounds = { x: 0.3, y: 0.295, width: 0.1, height: 0.055 };

  assert.deepEqual(mapper.geometry(file, request), codeRangeGeometry(file, request));
  assert.deepEqual(
    mapper.requestForSelection(file, selectionBounds, "tokenRange"),
    codeRangeRequestForSelection(file, selectionBounds, "tokenRange"),
  );
  assert.deepEqual(mapper.lineRangeForRequest(file, { lineStart: 20, lineEnd: 10 }), { start: 10, end: 20 });
  assert.deepEqual(mapper.tokenRangeForRequest(file, { columnStart: 24, columnEnd: 9 }), { start: 9, end: 24 });
});
