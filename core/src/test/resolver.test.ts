import assert from "node:assert/strict";
/**
 * P0 Behavior Contract — Resolver (BR-RESOLVER-001..005, 007).
 *
 * The resolved address is the system's primary key, so these pin the
 * observable resolution contract: path normalization, dispatch by range
 * presence, line/token sub-rectangle geometry, multi-fragment covering sets,
 * and the structural guard that rejects a corrupt/untrusted map. Exact geohash
 * digits are covered by geohash.test.ts; here we assert the resolver's own
 * rules (shape, clamping, slice direction, deep-link scheme).
 */
import test from "node:test";
import { isCodecharterCodemap, normalizePathForMap, resolveAddress } from "../main/resolver.ts";
import type { CodecharterCodemap, MapFileTarget, MapFolderTarget } from "../main/resolver.ts";

const file: MapFileTarget = {
  path: "src/app.ts",
  bounds: { x: 0, y: 0, width: 1, height: 1 },
  geo: { lat: 0, lon: 0, geohash: "gcpvj0duq533" },
  lineCount: 100,
  maxLineLength: 80,
};
const folder: MapFolderTarget = {
  path: "src",
  bounds: { x: 0, y: 0, width: 1, height: 1 },
  geo: { lat: 0, lon: 0, geohash: "s00000000000" },
};
const codemap: CodecharterCodemap = {
  files: { "src/app.ts": file },
  folders: { src: folder },
};

// ---------------------------------------------------------------------------
// BR-RESOLVER-001 — path normalization to map-key form
// ---------------------------------------------------------------------------

test("BR-RESOLVER-001 converts backslashes to forward slashes", () => {
  assert.equal(normalizePathForMap("src\\app.ts"), "src/app.ts");
});

test("BR-RESOLVER-001 strips a leading ./ prefix", () => {
  assert.equal(normalizePathForMap("./src/app.ts"), "src/app.ts");
});

test("BR-RESOLVER-001 strips trailing slashes", () => {
  assert.equal(normalizePathForMap("src/"), "src");
  assert.equal(normalizePathForMap("src///"), "src");
});

test("BR-RESOLVER-001 maps '.' (repo root) to the empty key", () => {
  assert.equal(normalizePathForMap("."), "");
});

test("BR-RESOLVER-001 leaves an already-normalized path unchanged", () => {
  assert.equal(normalizePathForMap("src/app.ts"), "src/app.ts");
});

// ---------------------------------------------------------------------------
// BR-RESOLVER-002 — dispatch by range presence; absent path throws
// ---------------------------------------------------------------------------

test("BR-RESOLVER-002 resolves a file path to a file address", () => {
  const address = resolveAddress(codemap, { path: "src/app.ts" });
  assert.equal(address.targetType, "file");
  assert.equal(address.level, "file");
  assert.equal(address.path, "src/app.ts");
  assert.equal(address.geohash, "gcpvj0d"); // file precision = 7
  assert.ok(address.deepLink.startsWith("codecharter://file/"));
  assert.equal(address.breadcrumb, "src > app.ts");
});

test("BR-RESOLVER-002 resolves a folder path to a folder address", () => {
  const address = resolveAddress(codemap, { path: "src" });
  assert.equal(address.targetType, "folder");
  assert.equal(address.level, "folder");
  assert.equal(address.geohash, "s000"); // folder precision = 4
  assert.ok(address.deepLink.startsWith("codecharter://folder/"));
});

test("BR-RESOLVER-002 normalizes the request path before lookup", () => {
  const address = resolveAddress(codemap, { path: "./src/app.ts/" });
  assert.equal(address.path, "src/app.ts");
});

test("BR-RESOLVER-002 throws when the path is not on the map", () => {
  assert.throws(() => resolveAddress(codemap, { path: "does/not/exist.ts" }), {
    message: "No map target found for path: does/not/exist.ts",
  });
});

// ---------------------------------------------------------------------------
// BR-RESOLVER-003 — line range -> vertical sub-rectangle, 1-based clamped
// ---------------------------------------------------------------------------

test("BR-RESOLVER-003 a line range yields a lineRange target spanning the full file width", () => {
  const address = resolveAddress(codemap, { path: "src/app.ts", lineStart: 10, lineEnd: 20 });
  assert.equal(address.targetType, "lineRange");
  assert.deepEqual(address.lineRange, { start: 10, end: 20 });
  // vertical slice: same x + width as the file box, reduced height
  assert.equal(address.bounds.x, file.bounds.x);
  assert.equal(address.bounds.width, file.bounds.width);
  assert.ok(address.bounds.height < file.bounds.height);
});

test("BR-RESOLVER-003 clamps lines to [1, lineCount]", () => {
  const address = resolveAddress(codemap, { path: "src/app.ts", lineStart: 0, lineEnd: 500 });
  assert.deepEqual(address.lineRange, { start: 1, end: 100 });
});

test("BR-RESOLVER-003 a single line still produces a non-zero (min 1 line) height", () => {
  const address = resolveAddress(codemap, { path: "src/app.ts", lineStart: 5, lineEnd: 5 });
  assert.deepEqual(address.lineRange, { start: 5, end: 5 });
  assert.ok(address.bounds.height > 0);
});

// ---------------------------------------------------------------------------
// BR-RESOLVER-004 — token/column range -> horizontal sub-rectangle
// ---------------------------------------------------------------------------

test("BR-RESOLVER-004 a column range yields a tokenRange target narrower than the file", () => {
  const address = resolveAddress(codemap, {
    path: "src/app.ts",
    lineStart: 10,
    lineEnd: 10,
    columnStart: 5,
    columnEnd: 40,
  });
  assert.equal(address.targetType, "tokenRange");
  assert.deepEqual(address.tokenRange, { start: 5, end: 40 });
  // horizontal slice: width reduced relative to the file box
  assert.ok(address.bounds.width < file.bounds.width);
});

test("BR-RESOLVER-004 clamps columns to [1, maxLineLength]", () => {
  const address = resolveAddress(codemap, {
    path: "src/app.ts",
    lineStart: 1,
    lineEnd: 1,
    columnStart: 0,
    columnEnd: 999,
  });
  assert.deepEqual(address.tokenRange, { start: 1, end: 80 });
});

// ---------------------------------------------------------------------------
// BR-RESOLVER-005 — multi-fragment ranges union bounds + sorted unique cover
// ---------------------------------------------------------------------------

test("BR-RESOLVER-005 fragments produce a sorted, de-duplicated covering set", () => {
  const address = resolveAddress(codemap, {
    path: "src/app.ts",
    lineStart: 1,
    lineEnd: 60,
    fragments: [
      { lineStart: 1, lineEnd: 5 },
      { lineStart: 50, lineEnd: 60 },
    ],
  });
  assert.ok(Array.isArray(address.fragments));
  assert.equal(address.fragments?.length, 2);
  const cover = address.coveringSet ?? [];
  assert.ok(cover.length >= 1);
  assert.deepEqual(cover, cover.toSorted()); // sorted
  assert.equal(new Set(cover).size, cover.length); // unique
});

// ---------------------------------------------------------------------------
// BR-RESOLVER-007 — codemap structural guard
// ---------------------------------------------------------------------------

test("BR-RESOLVER-007 accepts a well-formed codemap", () => {
  assert.equal(isCodecharterCodemap({ files: {}, folders: {} }), true);
});

test("BR-RESOLVER-007 rejects non-objects, arrays, null, and missing sections", () => {
  assert.equal(isCodecharterCodemap(null), false);
  assert.equal(isCodecharterCodemap([]), false);
  assert.equal(isCodecharterCodemap("nope"), false);
  assert.equal(isCodecharterCodemap({ files: {} }), false);
  assert.equal(isCodecharterCodemap({ folders: {} }), false);
  assert.equal(isCodecharterCodemap({ files: [], folders: {} }), false);
});
