import assert from "node:assert/strict";
/**
 * Tests for the geohash / code-plane projection module (`../main/geohash.ts`).
 *
 * Pin the deterministic projection contract: longitude-first interleaved
 * bisection, the frozen base-32 alphabet, code-plane <-> lat/lon mapping,
 * edge/wrap/clamp handling, center addressing, input rejection, and the
 * encode/decode inverse. The literal expected values define that contract;
 * the implementation must reproduce them exactly.
 */
import test from "node:test";
import {
  encodeGeohash,
  decodeGeohashBounds,
  codePointToGeo,
  geohashForBoundsCenter,
  codePlaneDescriptor,
} from "../main/geohash.ts";
import type {
  GeoCoordinate,
  GeohashBounds,
  GeohashedCoordinate,
  CodePlaneDescriptor,
} from "../main/geohash.ts";

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
const GEOHASH_EAST_EDGE = 180 - 1e-12; // 179.999999999999

// ---------------------------------------------------------------------------
// BR-001 — deterministic geohash address derivation (encodeGeohash)
// ---------------------------------------------------------------------------

test("BR-001 encodes (0,0) to the precision-12 golden address", () => {
  assert.equal(encodeGeohash(0, 0, 12), "s00000000000");
});

test("BR-001 precision defaults to 12 when omitted", () => {
  assert.equal(encodeGeohash(0, 0), "s00000000000");
  assert.equal(encodeGeohash(0, 0), encodeGeohash(0, 0, 12));
});

test("BR-001 encodes the north pole (lat 90)", () => {
  assert.equal(encodeGeohash(90, 0, 12), "upbpbpbpbpbp");
});

test("BR-001 encodes the south pole (lat -90)", () => {
  assert.equal(encodeGeohash(-90, 0, 12), "h00000000000");
});

test("BR-001 clamps latitude above 90 down to 90", () => {
  assert.equal(encodeGeohash(91, 0, 12), encodeGeohash(90, 0, 12));
  assert.equal(encodeGeohash(1000, 0, 12), "upbpbpbpbpbp");
});

test("BR-001 clamps latitude below -90 up to -90", () => {
  assert.equal(encodeGeohash(-91, 0, 12), encodeGeohash(-90, 0, 12));
  assert.equal(encodeGeohash(-1000, 0, 12), "h00000000000");
});

test("BR-001 wraps lon=180 to -180 (antimeridian, '>= 180' is out of range)", () => {
  assert.equal(encodeGeohash(0, 180, 12), "800000000000");
  assert.equal(encodeGeohash(0, 180, 12), encodeGeohash(0, -180, 12));
});

test("BR-001 keeps lon=-180 (lower bound is in range)", () => {
  assert.equal(encodeGeohash(0, -180, 12), "800000000000");
});

test("BR-001 wraps lon=540 to -180", () => {
  assert.equal(encodeGeohash(0, 540, 12), "800000000000");
  assert.equal(encodeGeohash(0, 540, 12), encodeGeohash(0, -180, 12));
});

test("BR-001 wraps lon=-270 to 90", () => {
  assert.equal(encodeGeohash(0, -270, 12), "w00000000000");
  assert.equal(encodeGeohash(0, -270, 12), encodeGeohash(0, 90, 12));
});

test("BR-001 encodes the north-east extreme (90, 180 -> wraps to -180)", () => {
  assert.equal(encodeGeohash(90, 180, 12), "bpbpbpbpbpbp");
});

test("BR-001 encodes the south-west extreme (-90, -180)", () => {
  assert.equal(encodeGeohash(-90, -180, 12), "000000000000");
});

test("BR-001 encodes London interior point", () => {
  assert.equal(encodeGeohash(51.5074, -0.1278, 12), "gcpvj0duq533");
});

test("BR-001 encodes Lisbon interior point", () => {
  assert.equal(encodeGeohash(38.7223, -9.1393, 12), "eycs210vwzgu");
});

test("BR-001 encodes New York interior point", () => {
  assert.equal(encodeGeohash(40.7128, -74.006, 12), "dr5regw3ppyz");
});

test("BR-001 encodes Sydney interior point", () => {
  assert.equal(encodeGeohash(-33.8688, 151.2093, 12), "r3gx2f77bn44");
});

test("BR-001 encodes San Francisco interior point", () => {
  assert.equal(encodeGeohash(37.7749, -122.4194, 12), "9q8yyk8ytpxr");
});

test("BR-001 midpoint tie on lon=0 / lat=0 resolves to the UPPER half ('s' bucket)", () => {
  // (0,0) sits exactly on the first lon midpoint (0) and first lat midpoint (0).
  // The encoder uses `>=`, so both go to the upper half -> first char 's'.
  assert.equal(encodeGeohash(0, 0, 5), "s0000");
  assert.equal(encodeGeohash(0, 0, 1), "s");
});

test("BR-001 midpoint tie on lon=90 resolves to the upper half ('w' bucket)", () => {
  // lon=90 is exactly the midpoint of the upper half [0,180]; lat=0 upper of [-90,90].
  assert.equal(encodeGeohash(0, 90, 1), "w");
});

test("BR-001 midpoint tie at (45,90) resolves upper on both axes ('y' bucket)", () => {
  assert.equal(encodeGeohash(45, 90, 5), "y0000");
});

// --- precision 1..12 prefix property ---------------------------------------

const LONDON_PREFIXES = [
  "g",
  "gc",
  "gcp",
  "gcpv",
  "gcpvj",
  "gcpvj0",
  "gcpvj0d",
  "gcpvj0du",
  "gcpvj0duq",
  "gcpvj0duq5",
  "gcpvj0duq53",
  "gcpvj0duq533",
];

for (let precision = 1; precision <= 12; precision += 1) {
  const expected = LONDON_PREFIXES[precision - 1]!;
  test(`BR-001 encodes London at precision ${precision} to ${expected}`, () => {
    assert.equal(encodeGeohash(51.5074, -0.1278, precision), expected);
  });
}

test("BR-001 precision N output is the N-char prefix of any precision M>N (prefix property)", () => {
  const lat = 51.5074;
  const lon = -0.1278;
  const full = encodeGeohash(lat, lon, 12);
  for (let precision = 1; precision <= 12; precision += 1) {
    assert.equal(
      encodeGeohash(lat, lon, precision),
      full.slice(0, precision),
      `precision ${precision} should equal the ${precision}-char prefix of the precision-12 hash`,
    );
  }
});

test("BR-001 prefix property holds for several arbitrary interior points", () => {
  const points: Array<[number, number]> = [
    [38.7223, -9.1393],
    [40.7128, -74.006],
    [-33.8688, 151.2093],
    [37.7749, -122.4194],
    [-12.34, 56.78],
  ];
  for (const [lat, lon] of points) {
    const full = encodeGeohash(lat, lon, 12);
    for (let precision = 1; precision <= 12; precision += 1) {
      assert.equal(encodeGeohash(lat, lon, precision), full.slice(0, precision));
    }
  }
});

// --- BASE32 alphabet invariant --------------------------------------------

test("BR-001 encoded strings only ever contain BASE32 chars (no a/i/l/o)", () => {
  const allowed = new Set(BASE32);
  assert.ok(!allowed.has("a") && !allowed.has("i") && !allowed.has("l") && !allowed.has("o"));
  const samples: Array<[number, number]> = [
    [0, 0],
    [90, 180],
    [-90, -180],
    [51.5074, -0.1278],
    [38.7223, -9.1393],
    [40.7128, -74.006],
    [-33.8688, 151.2093],
    [37.7749, -122.4194],
  ];
  for (const [lat, lon] of samples) {
    for (const char of encodeGeohash(lat, lon, 12)) {
      assert.ok(allowed.has(char), `char ${char} is not in the BASE32 alphabet`);
    }
  }
});

// --- error paths -----------------------------------------------------------

test("BR-001 throws on non-finite latitude", () => {
  assert.throws(() => encodeGeohash(Number.NaN, 0), {
    message: "Latitude and longitude must be finite numbers",
  });
  assert.throws(() => encodeGeohash(Infinity, 0), {
    message: "Latitude and longitude must be finite numbers",
  });
  assert.throws(() => encodeGeohash(-Infinity, 0), {
    message: "Latitude and longitude must be finite numbers",
  });
});

test("BR-001 throws on non-finite longitude", () => {
  assert.throws(() => encodeGeohash(0, Number.NaN), {
    message: "Latitude and longitude must be finite numbers",
  });
  assert.throws(() => encodeGeohash(0, Infinity), {
    message: "Latitude and longitude must be finite numbers",
  });
  assert.throws(() => encodeGeohash(0, -Infinity), {
    message: "Latitude and longitude must be finite numbers",
  });
});

test("BR-001 throws on precision 0", () => {
  assert.throws(() => encodeGeohash(0, 0, 0), {
    message: "Geohash precision must be a positive integer",
  });
});

test("BR-001 throws on non-integer precision 1.5", () => {
  assert.throws(() => encodeGeohash(0, 0, 1.5), {
    message: "Geohash precision must be a positive integer",
  });
});

test("BR-001 throws on negative precision -1", () => {
  assert.throws(() => encodeGeohash(0, 0, -1), {
    message: "Geohash precision must be a positive integer",
  });
});

test("BR-001 throws on NaN precision", () => {
  assert.throws(() => encodeGeohash(0, 0, Number.NaN), {
    message: "Geohash precision must be a positive integer",
  });
});

// ---------------------------------------------------------------------------
// BR-002 — decode (decodeGeohashBounds)
// ---------------------------------------------------------------------------

test("BR-002 decodes 's00000000000' to its golden bounding box", () => {
  assert.deepEqual(decodeGeohashBounds("s00000000000"), {
    lat: { min: 0, max: 1.6763806343078613e-7 },
    lon: { min: 0, max: 3.3527612686157227e-7 },
  });
});

test("BR-002 decodes 'gbsuv7zterht' to its golden bounding box", () => {
  assert.deepEqual(decodeGeohashBounds("gbsuv7zterht"), {
    lat: { min: 48.66904282942414, max: 48.669042997062206 },
    lon: { min: -4.329154416918755, max: -4.329154081642628 },
  });
});

test("BR-002 decodes single char 'u' to a 45x45-degree cell", () => {
  assert.deepEqual(decodeGeohashBounds("u"), {
    lat: { min: 45, max: 90 },
    lon: { min: 0, max: 45 },
  });
});

test("BR-002 decodes 'ezs42' to its golden bounding box", () => {
  assert.deepEqual(decodeGeohashBounds("ezs42"), {
    lat: { min: 42.5830078125, max: 42.626953125 },
    lon: { min: -5.625, max: -5.5810546875 },
  });
});

test("BR-002 decodes single char '0' to the south-west extreme cell", () => {
  assert.deepEqual(decodeGeohashBounds("0"), {
    lat: { min: -90, max: -45 },
    lon: { min: -180, max: -135 },
  });
});

test("BR-002 decodes single char 'z' to the north-east extreme cell", () => {
  assert.deepEqual(decodeGeohashBounds("z"), {
    lat: { min: 45, max: 90 },
    lon: { min: 135, max: 180 },
  });
});

test("BR-002 decodes London hash 'gcpvj0duq533' to its golden bounding box", () => {
  assert.deepEqual(decodeGeohashBounds("gcpvj0duq533"), {
    lat: { min: 51.50739999487996, max: 51.507400162518024 },
    lon: { min: -0.12780021876096725, max: -0.1277998834848404 },
  });
});

// --- round-trip property ---------------------------------------------------

function wrapLongitude(lon: number): number {
  if (lon >= -180 && lon < 180) {
    return lon;
  }
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

function clampLatitude(lat: number): number {
  return Math.min(90, Math.max(-90, lat));
}

test("BR-002 round-trip: encoded point falls inside its own decoded box (grid)", () => {
  for (let lat = -90; lat <= 90; lat += 15) {
    for (let lon = -180; lon < 180; lon += 15) {
      const hash = encodeGeohash(lat, lon, 12);
      const box = decodeGeohashBounds(hash);
      const cLat = clampLatitude(lat);
      const cLon = wrapLongitude(lon);
      assert.ok(
        cLat >= box.lat.min && cLat <= box.lat.max,
        `lat ${cLat} not in [${box.lat.min}, ${box.lat.max}] for ${hash}`,
      );
      assert.ok(
        cLon >= box.lon.min && cLon <= box.lon.max,
        `lon ${cLon} not in [${box.lon.min}, ${box.lon.max}] for ${hash}`,
      );
    }
  }
});

test("BR-002 round-trip: random sample stays inside decoded box", () => {
  // Deterministic LCG so the sample is reproducible.
  let state = 1_332_534_784;
  const rand = () => {
    state = (1103515245 * state + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  for (let i = 0; i < 2000; i += 1) {
    const lat = rand() * 180 - 90;
    const lon = rand() * 360 - 180;
    const hash = encodeGeohash(lat, lon, 12);
    const box = decodeGeohashBounds(hash);
    const cLat = clampLatitude(lat);
    const cLon = wrapLongitude(lon);
    assert.ok(cLat >= box.lat.min && cLat <= box.lat.max, `lat ${cLat} escaped ${hash}`);
    assert.ok(cLon >= box.lon.min && cLon <= box.lon.max, `lon ${cLon} escaped ${hash}`);
  }
});

// --- decode error paths ----------------------------------------------------

test("BR-002 throws on empty string", () => {
  assert.throws(() => decodeGeohashBounds(""), {
    message: "Geohash must be a non-empty string",
  });
});

test("BR-002 throws 'Invalid geohash character' for excluded letter 'a'", () => {
  assert.throws(() => decodeGeohashBounds("a"), {
    message: "Invalid geohash character: a",
  });
});

test("BR-002 throws 'Invalid geohash character' for excluded letter 'i'", () => {
  assert.throws(() => decodeGeohashBounds("i"), {
    message: "Invalid geohash character: i",
  });
});

test("BR-002 throws 'Invalid geohash character' for excluded letter 'l'", () => {
  assert.throws(() => decodeGeohashBounds("l"), {
    message: "Invalid geohash character: l",
  });
});

test("BR-002 throws 'Invalid geohash character' for excluded letter 'o'", () => {
  assert.throws(() => decodeGeohashBounds("o"), {
    message: "Invalid geohash character: o",
  });
});

test("BR-002 throws 'Invalid geohash character' for punctuation '!'", () => {
  assert.throws(() => decodeGeohashBounds("!"), {
    message: "Invalid geohash character: !",
  });
});

test("BR-002 reports the FIRST invalid character in a mixed string", () => {
  // 'g' and 'c' are valid; 'A' (uppercase) is the first invalid char.
  assert.throws(() => decodeGeohashBounds("gcA"), {
    message: "Invalid geohash character: A",
  });
});

// ---------------------------------------------------------------------------
// codePointToGeo (part of BR-001)
// ---------------------------------------------------------------------------

test("codePointToGeo maps (0,0) to lat 90 / lon -180 (top-left = NW corner)", () => {
  assert.deepEqual(codePointToGeo({ x: 0, y: 0 }), { lon: -180, lat: 90 });
});

test("codePointToGeo maps (1,1) to lat -90 / lon (180 - 1e-12), not 180", () => {
  const geo = codePointToGeo({ x: 1, y: 1 });
  assert.equal(geo.lat, -90);
  assert.equal(geo.lon, GEOHASH_EAST_EDGE);
  assert.equal(geo.lon, 179.999999999999);
  assert.notEqual(geo.lon, 180);
});

test("codePointToGeo maps (0.5,0.5) to the origin lat 0 / lon 0", () => {
  assert.deepEqual(codePointToGeo({ x: 0.5, y: 0.5 }), { lon: 0, lat: 0 });
});

test("codePointToGeo inverts the y axis (y=0 is north, y=1 is south)", () => {
  assert.equal(codePointToGeo({ x: 0.5, y: 0 }).lat, 90);
  assert.equal(codePointToGeo({ x: 0.5, y: 1 }).lat, -90);
});

test("codePointToGeo clamps x>1 and y<0 into [0,1] before projecting", () => {
  // x=1.5 clamps to 1 -> hits the x>=1 special case -> lon = 180 - 1e-12.
  // y=-0.3 clamps to 0 -> lat 90.
  assert.deepEqual(codePointToGeo({ x: 1.5, y: -0.3 }), { lon: GEOHASH_EAST_EDGE, lat: 90 });
});

test("codePointToGeo x>=1 special case yields lon = 180 - 1e-12 exactly", () => {
  assert.equal(codePointToGeo({ x: 1, y: 0 }).lon, GEOHASH_EAST_EDGE);
  assert.equal(codePointToGeo({ x: 1.5, y: 0 }).lon, GEOHASH_EAST_EDGE);
});

test("codePointToGeo maps (0.25,0.75) to lat -45 / lon -90", () => {
  assert.deepEqual(codePointToGeo({ x: 0.25, y: 0.75 }), { lon: -90, lat: -45 });
});

test("codePointToGeo maps an interior point just shy of the east edge linearly (no special case)", () => {
  assert.deepEqual(codePointToGeo({ x: 0.999999, y: 0.000001 }), {
    lon: 179.99964,
    lat: 89.99982,
  });
});

test("codePointToGeo throws on non-finite x", () => {
  assert.throws(() => codePointToGeo({ x: Number.NaN, y: 0 }), {
    message: "Code-plane point coordinates must be finite numbers",
  });
});

test("codePointToGeo throws on non-finite y", () => {
  assert.throws(() => codePointToGeo({ x: 0, y: Infinity }), {
    message: "Code-plane point coordinates must be finite numbers",
  });
});

// ---------------------------------------------------------------------------
// geohashForBoundsCenter
// ---------------------------------------------------------------------------

test("geohashForBoundsCenter on the full plane {0,0,1,1} hashes the origin", () => {
  assert.deepEqual(geohashForBoundsCenter({ x: 0, y: 0, width: 1, height: 1 }), {
    lon: 0,
    lat: 0,
    geohash: "s00000000000",
  });
});

test("geohashForBoundsCenter returns an object shaped {lat, lon, geohash}", () => {
  const result = geohashForBoundsCenter({ x: 0, y: 0, width: 1, height: 1 });
  assert.deepEqual(Object.keys(result).toSorted(), ["geohash", "lat", "lon"]);
  assert.equal(typeof result.lat, "number");
  assert.equal(typeof result.lon, "number");
  assert.equal(typeof result.geohash, "string");
});

test("geohashForBoundsCenter uses center = (x+width/2, y+height/2)", () => {
  // top-left quadrant {0,0,0.5,0.5} -> center (0.25,0.25) -> lat 45 / lon -90.
  assert.deepEqual(geohashForBoundsCenter({ x: 0, y: 0, width: 0.5, height: 0.5 }), {
    lon: -90,
    lat: 45,
    geohash: "f00000000000",
  });
});

test("geohashForBoundsCenter centered-on-origin bounds also hash the origin", () => {
  assert.deepEqual(geohashForBoundsCenter({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }), {
    lon: 0,
    lat: 0,
    geohash: "s00000000000",
  });
});

test("geohashForBoundsCenter handles an arbitrary off-center rectangle", () => {
  assert.deepEqual(geohashForBoundsCenter({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }), {
    lon: -90,
    lat: 18,
    geohash: "d50n2hb1850n",
  });
});

test("geohashForBoundsCenter honors the precision argument", () => {
  assert.deepEqual(geohashForBoundsCenter({ x: 0, y: 0, width: 1, height: 1 }, 5), {
    lon: 0,
    lat: 0,
    geohash: "s0000",
  });
});

// ---------------------------------------------------------------------------
// codePlaneDescriptor
// ---------------------------------------------------------------------------

test("codePlaneDescriptor returns the fixed unit-square bounds", () => {
  assert.deepEqual(codePlaneDescriptor().bounds, { x: 0, y: 0, width: 1, height: 1 });
});

test("codePlaneDescriptor reports the internal geo domain", () => {
  assert.deepEqual(codePlaneDescriptor().internalGeoDomain, {
    lat: { min: -90, max: 90 },
    lon: { min: -180, max: 180 },
  });
});

test("codePlaneDescriptor.transform.xToLon literally embeds 180 - 1e-12", () => {
  assert.equal(codePlaneDescriptor().transform.xToLon, "x >= 1 ? 179.999999999999 : x * 360 - 180");
});

test("codePlaneDescriptor.transform.yToLat is exactly '90 - y * 180'", () => {
  assert.equal(codePlaneDescriptor().transform.yToLat, "90 - y * 180");
});

test("codePlaneDescriptor returns the full descriptor object verbatim", () => {
  assert.deepEqual(codePlaneDescriptor(), {
    bounds: { x: 0, y: 0, width: 1, height: 1 },
    internalGeoDomain: {
      lat: { min: -90, max: 90 },
      lon: { min: -180, max: 180 },
    },
    transform: {
      xToLon: "x >= 1 ? 179.999999999999 : x * 360 - 180",
      yToLat: "90 - y * 180",
    },
  });
});

// ---------------------------------------------------------------------------
// Exported type surface — compile-time assertions.
// These never run; they fail the build if the modern module drops or renames
// a type. (tsx type-checks lazily, but `pnpm typecheck` against tsconfig will.)
// ---------------------------------------------------------------------------

test("type surface is preserved (compile-time)", () => {
  const geo: GeoCoordinate = { lat: 0, lon: 0 };
  const bounds: GeohashBounds = { lat: { min: 0, max: 0 }, lon: { min: 0, max: 0 } };
  const hashed: GeohashedCoordinate = { lat: 0, lon: 0, geohash: "s" };
  const descriptor: CodePlaneDescriptor = codePlaneDescriptor();
  assert.ok(geo && bounds && hashed && descriptor);
});
