import test from "node:test";
import assert from "node:assert/strict";
import { codePlaneDescriptor, codePointToGeo, decodeGeohashBounds, encodeGeohash } from "../src/geohash.js";

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

test("rejects invalid geohash decode characters without uppercase aliases", () => {
  assert.throws(() => decodeGeohashBounds("a"), /Invalid geohash character: a/);
  assert.throws(() => decodeGeohashBounds("E"), /Invalid geohash character: E/);
});

test("maps the code plane into the standard geohash domain", () => {
  assert.deepEqual(codePointToGeo({ x: 0, y: 0 }), { lon: -180, lat: 90 });
  assert.deepEqual(codePointToGeo({ x: 0.5, y: 0.5 }), { lon: 0, lat: 0 });
  const eastEdge = codePointToGeo({ x: 1, y: 1 });
  assert.equal(eastEdge.lat, -90);
  assert.ok(eastEdge.lon < 180);
  assert.ok(eastEdge.lon > 179.999999999);
});

test("exposes a sidecar code-plane descriptor that matches the coordinate transform", () => {
  const descriptor = codePlaneDescriptor();
  assert.equal(descriptor.transform.xToLon, "x >= 1 ? 179.999999999999 : x * 360 - 180");
  assert.equal(descriptor.transform.yToLat, "90 - y * 180");

  for (const point of [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.5 },
    { x: 1, y: 1 },
  ]) {
    const geo = codePointToGeo(point);
    assert.equal(descriptorLon(point.x), geo.lon);
    assert.equal(descriptorLat(point.y), geo.lat);
  }

  descriptor.bounds.x = 99;
  assert.equal(codePlaneDescriptor().bounds.x, 0);
});

function descriptorLon(x: number): number {
  return x >= 1 ? 179.999999999999 : x * 360 - 180;
}

function descriptorLat(y: number): number {
  return 90 - y * 180;
}

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

test("precision-12 geohashes empirically bound dense code-plane coordinates under one nanounit", () => {
  let maxHalfWidth = 0;
  let maxHalfHeight = 0;
  let checked = 0;
  const points = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ];

  for (let yIndex = 0; yIndex <= 64; yIndex += 1) {
    for (let xIndex = 0; xIndex <= 64; xIndex += 1) {
      points.push({
        x: xIndex / 64,
        y: yIndex / 64,
      });
    }
  }

  for (const point of points) {
    const geo = codePointToGeo(point);
    const geohash = encodeGeohash(geo.lat, geo.lon, 12);
    const decoded = decodeGeohashBounds(geohash);
    const cell = decodedGeohashToCodeBounds(decoded);

    assert.ok(cell.x <= point.x && point.x <= cell.x + cell.width, JSON.stringify({ point, geohash, cell }));
    assert.ok(cell.y <= point.y && point.y <= cell.y + cell.height, JSON.stringify({ point, geohash, cell }));
    assert.equal(encodeGeohash(geo.lat, geo.lon, 12), geohash);
    maxHalfWidth = Math.max(maxHalfWidth, cell.width / 2);
    maxHalfHeight = Math.max(maxHalfHeight, cell.height / 2);
    checked += 1;
  }

  assert.equal(checked, 4229);
  assert.ok(maxHalfWidth < 1e-9, `maxHalfWidth ${maxHalfWidth}`);
  assert.ok(maxHalfHeight < 1e-9, `maxHalfHeight ${maxHalfHeight}`);
});

test("rejects non-finite code-plane coordinates before encoding", () => {
  assert.throws(
    () => codePointToGeo({ x: Number.NaN, y: 0.5 }),
    /finite/,
  );
});

function decodedGeohashToCodeBounds(bounds: ReturnType<typeof decodeGeohashBounds>) {
  const x1 = (bounds.lon.min + 180) / 360;
  const x2 = (bounds.lon.max + 180) / 360;
  const y1 = (90 - bounds.lat.max) / 180;
  const y2 = (90 - bounds.lat.min) / 180;
  return {
    x: Math.max(0, x1),
    y: Math.max(0, y1),
    width: Math.min(1, x2) - Math.max(0, x1),
    height: Math.min(1, y2) - Math.max(0, y1),
  };
}
