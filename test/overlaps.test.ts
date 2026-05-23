import test from "node:test";
import assert from "node:assert/strict";
import { findNamedPlaceOverlaps } from "../src/overlaps.js";
import { required } from "../test-support/assertions.ts";

test("finds visible overlap bounds between named drawn selections", () => {
  const overlaps = findNamedPlaceOverlaps([
    namedRect("a", "Search", { x: 0.1, y: 0.1, width: 0.4, height: 0.4 }),
    namedRect("b", "Auth", { x: 0.3, y: 0.2, width: 0.4, height: 0.2 }),
    namedRect("c", "Elsewhere", { x: 0.8, y: 0.8, width: 0.1, height: 0.1 }),
  ]);

  assert.equal(overlaps.length, 1);
  const overlap = required(overlaps[0]);
  assert.deepEqual(overlap.placeIds, ["a", "b"]);
  assert.deepEqual(overlap.names, ["Search", "Auth"]);
  assert.deepEqual(overlap.bounds, { x: 0.3, y: 0.2, width: 0.2, height: 0.2 });
});

test("keeps overlap results ordered by original drawn selection pairs", () => {
  const overlaps = findNamedPlaceOverlaps([
    namedRect("late-x", "Late X", { x: 0.7, y: 0.1, width: 0.2, height: 0.2 }),
    namedRect("wide", "Wide", { x: 0.1, y: 0.1, width: 0.8, height: 0.2 }),
    namedRect("early-x", "Early X", { x: 0.05, y: 0.1, width: 0.2, height: 0.2 }),
    namedRect("middle", "Middle", { x: 0.3, y: 0.1, width: 0.2, height: 0.2 }),
  ]);

  assert.deepEqual(overlaps.map((overlap) => overlap.placeIds), [
    ["late-x", "wide"],
    ["wide", "early-x"],
    ["wide", "middle"],
  ]);
});

test("ignores non-rect places and selections that only touch edges", () => {
  const overlaps = findNamedPlaceOverlaps([
    namedRect("a", "A", { x: 0, y: 0, width: 0.2, height: 0.2 }),
    namedRect("touching", "Touching", { x: 0.2, y: 0, width: 0.2, height: 0.2 }),
    { id: "annotation", name: "Annotation", kind: "mapAnnotation", geometry: { type: "rect", bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } } },
    { id: "polygon", name: "Polygon", kind: "drawnSelection", geometry: { type: "polygon" } },
  ]);

  assert.deepEqual(overlaps, []);
});

test("keeps long-running selections active while expired selections fall away", () => {
  const places = [
    namedRect("wide", "Wide", { x: 0, y: 0.1, width: 0.8, height: 0.2 }),
  ];
  for (let index = 0; index < 20; index += 1) {
    places.push(namedRect(`expired-${index}`, `Expired ${index}`, {
      x: 0.01 + index * 0.01,
      y: 0.7,
      width: 0.005,
      height: 0.05,
    }));
  }
  places.push(namedRect("late", "Late", { x: 0.7, y: 0.15, width: 0.2, height: 0.1 }));

  assert.deepEqual(findNamedPlaceOverlaps(places).map((overlap) => overlap.placeIds), [
    ["wide", "late"],
  ]);
});

function namedRect(id: string, name: string, bounds: { x: number; y: number; width: number; height: number }) {
  return {
    id,
    name,
    kind: "drawnSelection",
    geometry: { type: "rect", bounds },
  };
}
