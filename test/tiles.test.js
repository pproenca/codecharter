import test from "node:test";
import assert from "node:assert/strict";
import { buildTileIndex, getTile, visiblePrefixes } from "../src/tiles.js";

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
  assert.equal(tiles[0].targets.length, 2);
  assert.deepEqual(visiblePrefixes(codemap, "folder"), ["s123", "u987"]);
});

test("returns one tile by prefix", () => {
  const tile = getTile(codemap, { level: "folder", prefix: "s123" });

  assert.equal(tile.prefix, "s123");
  assert.equal(tile.targets.length, 2);
  assert.equal(tile.targets[0].path, "src");
});

function target(path, geohash, bounds) {
  return {
    path,
    name: path.split("/").at(-1),
    bounds,
    geo: { geohash, lat: 0, lon: 0 },
    lineCount: 10,
    weight: 10,
  };
}
