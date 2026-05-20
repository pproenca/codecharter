import test from "node:test";
import assert from "node:assert/strict";
import { codePointToGeo, encodeGeohash } from "../src/geohash.js";

test("encodes geohashes with the standard alphabet and longitude-first interleaving", () => {
  assert.equal(encodeGeohash(42.6, -5.6, 5), "ezs42");
});

test("maps the code plane into the standard geohash domain", () => {
  assert.deepEqual(codePointToGeo({ x: 0, y: 0 }), { lon: -180, lat: 90 });
  assert.deepEqual(codePointToGeo({ x: 0.5, y: 0.5 }), { lon: 0, lat: 0 });
  assert.deepEqual(codePointToGeo({ x: 1, y: 1 }), { lon: 180, lat: -90 });
});
