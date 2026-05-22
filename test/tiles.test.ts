import test from "node:test";
import assert from "node:assert/strict";
import { TileIndexBuilder, buildTileIndex, getTile, visiblePrefixes } from "../src/tiles.js";

const codemap = {
  folders: {
    src: target("src", "s12345678901", { x: 0, y: 0, width: 0.5, height: 1 }),
  },
  files: {
    "src/a.ts": target("src/a.ts", "s12345678901", { x: 0, y: 0, width: 0.25, height: 1 }),
    "src/b.ts": target("src/b.ts", "u98765432109", { x: 0.25, y: 0, width: 0.25, height: 1 }),
  },
};

test("builds geohash-prefix tiles at a map level", () => {
  const tiles = buildTileIndex(codemap, "folder");

  assert.deepEqual(tiles.map((tile) => tile.prefix), ["s123", "u987"]);
  assert.equal(required(tiles[0]).targets.length, 2);
  assert.deepEqual(visiblePrefixes(codemap, "folder"), ["s123", "u987"]);
});

test("returns one tile by prefix", () => {
  const tile = getTile(codemap, { level: "folder", prefix: "s123" });

  assert.equal(tile.prefix, "s123");
  assert.equal(tile.targets.length, 2);
  assert.equal(required(tile.targets[0]).path, "src");
});

test("orders tile targets deterministically by map target kind and path", () => {
  const unorderedCodemap = {
    folders: {
      "src/utils": target("src/utils", "s12345678901", { x: 0.2, y: 0, width: 0.2, height: 1 }),
      src: target("src", "s12345678901", { x: 0, y: 0, width: 0.4, height: 1 }),
    },
    files: {
      "src/b.ts": target("src/b.ts", "s12345678901", { x: 0.3, y: 0, width: 0.1, height: 1 }),
      "src/a.ts": target("src/a.ts", "s12345678901", { x: 0.2, y: 0, width: 0.1, height: 1 }),
    },
  };

  const tile = getTile(unorderedCodemap, { level: "folder", prefix: "s123" });

  assert.deepEqual(tile.targets.map((target) => target.path), [
    "src",
    "src/utils",
    "src/a.ts",
    "src/b.ts",
  ]);
});

test("TileIndexBuilder keeps the exported class facade behaviour", () => {
  const builder = new TileIndexBuilder();

  assert.deepEqual(builder.build(codemap, "folder"), buildTileIndex(codemap, "folder"));
  assert.deepEqual(builder.get(codemap, { level: "folder", prefix: "s123" }), getTile(codemap, { level: "folder", prefix: "s123" }));
  assert.deepEqual(builder.visiblePrefixes(codemap, "folder"), visiblePrefixes(codemap, "folder"));
  assert.equal(builder.prefixForTarget(codemap.files["src/a.ts"], "folder"), "s123");
});

function target(path: string, geohash: string, bounds: { x: number; y: number; width: number; height: number }) {
  return {
    path,
    name: path.split("/").at(-1) ?? path,
    bounds,
    geo: { geohash, lat: 0, lon: 0 },
    lineCount: 10,
    weight: 10,
  };
}

function required<T>(value: T | null | undefined): T {
  assert.ok(value);
  return value;
}
