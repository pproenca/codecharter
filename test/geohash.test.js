import test from "node:test";
import assert from "node:assert/strict";
import { codePointToGeo, encodeGeohash } from "../src/geohash.js";

test("encodes geohashes with the standard alphabet and longitude-first interleaving", () => {
  assert.equal(encodeGeohash(42.6, -5.6, 5), "ezs42");
});

test("maps the code plane into the standard geohash domain", () => {
  assert.deepEqual(codePointToGeo({ x: 0, y: 0 }), { lon: -180, lat: 90 });
  assert.deepEqual(codePointToGeo({ x: 0.5, y: 0.5 }), { lon: 0, lat: 0 });
  const eastEdge = codePointToGeo({ x: 1, y: 1 });
  assert.equal(eastEdge.lat, -90);
  assert.ok(eastEdge.lon < 180);
  assert.ok(eastEdge.lon > 179.999999999);
});

test("keeps the code plane east edge out of the antimeridian alias", () => {
  const west = codePointToGeo({ x: 0, y: 0.5 });
  const east = codePointToGeo({ x: 1, y: 0.5 });

  assert.equal(encodeGeohash(west.lat, west.lon, 2), "80");
  assert.equal(encodeGeohash(east.lat, east.lon, 2), "xb");
});

test("rejects non-finite code-plane coordinates before encoding", () => {
  assert.throws(
    () => codePointToGeo({ x: Number.NaN, y: 0.5 }),
    /finite/,
  );
});
