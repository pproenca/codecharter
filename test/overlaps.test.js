import test from "node:test";
import assert from "node:assert/strict";
import { findNamedPlaceOverlaps } from "../src/overlaps.js";

test("finds visible overlap bounds between named drawn selections", () => {
  const overlaps = findNamedPlaceOverlaps([
    namedRect("a", "Search", { x: 0.1, y: 0.1, width: 0.4, height: 0.4 }),
    namedRect("b", "Auth", { x: 0.3, y: 0.2, width: 0.4, height: 0.2 }),
    namedRect("c", "Elsewhere", { x: 0.8, y: 0.8, width: 0.1, height: 0.1 }),
  ]);

  assert.equal(overlaps.length, 1);
  assert.deepEqual(overlaps[0].placeIds, ["a", "b"]);
  assert.deepEqual(overlaps[0].names, ["Search", "Auth"]);
  assert.deepEqual(overlaps[0].bounds, { x: 0.3, y: 0.2, width: 0.2, height: 0.2 });
});

function namedRect(id, name, bounds) {
  return {
    id,
    name,
    kind: "drawnSelection",
    geometry: { type: "rect", bounds },
  };
}
