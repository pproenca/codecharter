import test from "node:test";
import assert from "node:assert/strict";
import { createNamedSelection, resolveSelection } from "../src/selections.js";

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
