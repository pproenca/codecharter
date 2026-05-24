import assert from "node:assert/strict";
import test from "node:test";
import { findNamedPlaceOverlaps, MAX_NAMED_PLACE_OVERLAPS } from "../main/overlaps.ts";
import type { NamedSelection } from "../main/selections.ts";

test("findNamedPlaceOverlaps caps dense overlap output", () => {
  const places = Array.from({ length: 500 }, (_, index) => drawnSelection(index));

  const overlaps = findNamedPlaceOverlaps(places);

  assert.equal(overlaps.length, MAX_NAMED_PLACE_OVERLAPS);
  assert.deepEqual(overlaps[0]?.placeIds, ["place-0", "place-1"]);
});

function drawnSelection(index: number): NamedSelection {
  return {
    id: `place-${index}`,
    name: `Place ${index}`,
    kind: "drawnSelection",
    level: "file",
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z",
    geometry: { type: "rect", bounds: { x: 0, y: 0, width: 1, height: 1 } },
    spatialFrame: {
      level: "file",
      precision: 12,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      corners: {
        northWest: "s00000000000",
        northEast: "s00000000000",
        southWest: "s00000000000",
        southEast: "s00000000000",
      },
    },
    coveringSet: [],
    resolvedTargets: [],
  };
}
