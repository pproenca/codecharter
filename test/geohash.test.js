import test from "node:test";
import assert from "node:assert/strict";
import { codePointToGeo, decodeGeohashBounds, encodeGeohash } from "../src/geohash.js";

test("encodes geohashes with the standard alphabet and longitude-first interleaving", () => {
  assert.equal(encodeGeohash(42.6, -5.6, 5), "ezs42");
});

test("decodes geohash bounds by mirroring encoder interval bisection", () => {
  const bounds = decodeGeohashBounds("ezs42");

  assert.equal(bounds.lat.min <= 42.6 && 42.6 <= bounds.lat.max, true);
  assert.equal(bounds.lon.min <= -5.6 && -5.6 <= bounds.lon.max, true);

  const center = {
    lat: (bounds.lat.min + bounds.lat.max) / 2,
    lon: (bounds.lon.min + bounds.lon.max) / 2,
  };
  assert.equal(encodeGeohash(center.lat, center.lon, 5), "ezs42");
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

test("every encoded code-plane point falls inside its decoded geohash cell", () => {
  for (const point of [
    { x: 0, y: 0 },
    { x: 0.125, y: 0.875 },
    { x: 0.5, y: 0.5 },
    { x: 0.999999, y: 1 },
  ]) {
    const geo = codePointToGeo(point);
    const geohash = encodeGeohash(geo.lat, geo.lon, 12);
    const bounds = decodeGeohashBounds(geohash);
    assert.equal(bounds.lat.min <= geo.lat && geo.lat <= bounds.lat.max, true);
    assert.equal(bounds.lon.min <= geo.lon && geo.lon <= bounds.lon.max, true);
  }
});

test("rejects non-finite code-plane coordinates before encoding", () => {
  assert.throws(
    () => codePointToGeo({ x: Number.NaN, y: 0.5 }),
    /finite/,
  );
});
