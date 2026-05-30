/**
 * Geohash / code-plane projection — the deterministic addressing kernel of
 * `@codecharter/core`.
 *
 * Implements:
 *  - **BR-001 (P0)** Deterministic geohash address derivation
 *    (`encodeGeohash`, `codePointToGeo`, `geohashForBoundsCenter`, longitude
 *    wrap, the `x >= 1` east-edge epsilon).
 *  - **BR-002 (P1)** Geohash decode to lat/lon bounds (`decodeGeohashBounds`).
 *
 * The unit-square code plane maps to lat/lon as `lon = x*360 - 180`,
 * `lat = 90 - y*180` (the Y axis is inverted: the top of the map is north).
 * Output must be byte-for-byte reproducible across runs, so every arithmetic
 * step here is load-bearing: the `>=` midpoint tie (ties resolve to the upper
 * half), the `1e-12` east-edge epsilon, and the half-open `[-180, 180)`
 * longitude wrap are all behavioral contract, not incidental detail.
 */

import type {
  CodePlaneDescriptor,
  GeoCoordinate,
  GeohashBounds,
  GeohashedCoordinate,
} from "./geo-types.ts";
import type { Bounds, Point } from "./geometry.ts";
import { clamp } from "./math.ts";

export type {
  GeoCoordinate,
  GeohashBounds,
  GeohashedCoordinate,
  CodePlaneDescriptor,
} from "./geo-types.ts";

/** Geohash base-32 alphabet — note the deliberate omission of `a`, `i`, `l`, `o`. */
const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
const DECODE = new Map<string, number>([...BASE32].map((char, index) => [char, index]));
const BITS_PER_CHAR = 5;

/** Default address precision (matches `MapLevel.lineRange`/`tokenRange`, BR-003). */
const DEFAULT_PRECISION = 12;

/**
 * Nudge applied at the east edge (`x >= 1`) so the easternmost column maps just
 * inside +180° instead of wrapping back to −180° (BR-001). At precision 12 this
 * is far smaller than one geohash cell, so it never crosses a cell boundary.
 */
const EAST_EDGE_EPSILON = 1e-12;

const LAT_BOUNDS = { min: -90, max: 90 };
const LON_BOUNDS = { min: -180, max: 180 };

/**
 * Encode a lat/lon pair as a base-32 geohash by interleaved bisection
 * (longitude on even bits, latitude on odd), 5 bits per character. **BR-001.**
 *
 * @throws if `lat`/`lon` are not finite, or `precision` is not a positive integer.
 */
export function encodeGeohash(lat: number, lon: number, precision = DEFAULT_PRECISION): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("Latitude and longitude must be finite numbers");
  }
  if (!Number.isInteger(precision) || precision < 1) {
    throw new Error("Geohash precision must be a positive integer");
  }

  const latitude = clamp(lat, LAT_BOUNDS.min, LAT_BOUNDS.max);
  const longitude = wrapLongitude(lon);

  let latMin = LAT_BOUNDS.min;
  let latMax = LAT_BOUNDS.max;
  let lonMin = LON_BOUNDS.min;
  let lonMax = LON_BOUNDS.max;

  let encodeLongitude = true; // even bits encode longitude
  let bitsInChar = 0;
  let charIndex = 0;
  let geohash = "";

  while (geohash.length < precision) {
    if (encodeLongitude) {
      const mid = (lonMin + lonMax) / 2;
      if (longitude >= mid) {
        charIndex = (charIndex << 1) + 1;
        lonMin = mid;
      } else {
        charIndex <<= 1;
        lonMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (latitude >= mid) {
        charIndex = (charIndex << 1) + 1;
        latMin = mid;
      } else {
        charIndex <<= 1;
        latMax = mid;
      }
    }

    encodeLongitude = !encodeLongitude;
    bitsInChar += 1;

    if (bitsInChar === BITS_PER_CHAR) {
      // `charIndex` is guaranteed to be 0..31 by the 5-bit accumulator above,
      // so `charAt` always returns a real BASE32 char (never the empty string).
      geohash += BASE32.charAt(charIndex);
      bitsInChar = 0;
      charIndex = 0;
    }
  }

  return geohash;
}

/**
 * Decode a geohash to the lat/lon bounding box it covers (inverse of
 * {@link encodeGeohash}). **BR-002.**
 *
 * @throws if `geohash` is empty or contains a non-base-32 character.
 */
export function decodeGeohashBounds(geohash: string): GeohashBounds {
  if (typeof geohash !== "string" || geohash.length === 0) {
    throw new Error("Geohash must be a non-empty string");
  }

  let latMin = LAT_BOUNDS.min;
  let latMax = LAT_BOUNDS.max;
  let lonMin = LON_BOUNDS.min;
  let lonMax = LON_BOUNDS.max;
  let decodeLongitude = true;

  for (const char of geohash) {
    const index = DECODE.get(char);
    if (index === undefined) {
      throw new Error(`Invalid geohash character: ${char}`);
    }

    for (let mask = 1 << (BITS_PER_CHAR - 1); mask > 0; mask >>= 1) {
      const upperHalf = (index & mask) !== 0;
      if (decodeLongitude) {
        const mid = (lonMin + lonMax) / 2;
        if (upperHalf) {
          lonMin = mid;
        } else {
          lonMax = mid;
        }
      } else {
        const mid = (latMin + latMax) / 2;
        if (upperHalf) {
          latMin = mid;
        } else {
          latMax = mid;
        }
      }
      decodeLongitude = !decodeLongitude;
    }
  }

  return {
    lat: { min: latMin, max: latMax },
    lon: { min: lonMin, max: lonMax },
  };
}

/**
 * Project a unit-square code-plane point to lat/lon. The point is clamped to
 * `[0, 1]²`; the east edge (`x >= 1`) is nudged inside +180° by
 * {@link EAST_EDGE_EPSILON}; the Y axis is inverted (y=0 → north). **BR-001.**
 *
 * @throws if the point's coordinates are not finite.
 */
export function codePointToGeo(point: Point): GeoCoordinate {
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
    throw new Error("Code-plane point coordinates must be finite numbers");
  }

  const x = clamp(point.x, 0, 1);
  const y = clamp(point.y, 0, 1);

  return {
    lon: x >= 1 ? 180 - EAST_EDGE_EPSILON : x * 360 - 180,
    lat: 90 - y * 180,
  };
}

/**
 * The canonical address of a code-plane rectangle: encode the geohash of its
 * center (`x + width/2`, `y + height/2`). **BR-001.**
 */
export function geohashForBoundsCenter(
  bounds: Bounds,
  precision = DEFAULT_PRECISION,
): GeohashedCoordinate {
  const center: Point = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  const geo = codePointToGeo(center);
  return {
    ...geo,
    geohash: encodeGeohash(geo.lat, geo.lon, precision),
  };
}

/**
 * Self-describing projection metadata embedded in the codemap so external
 * consumers can reproduce addresses without importing this module. The
 * `transform` strings document the exact formulas used above.
 */
export function codePlaneDescriptor(): CodePlaneDescriptor {
  return {
    bounds: { x: 0, y: 0, width: 1, height: 1 },
    internalGeoDomain: {
      lat: { min: LAT_BOUNDS.min, max: LAT_BOUNDS.max },
      lon: { min: LON_BOUNDS.min, max: LON_BOUNDS.max },
    },
    transform: {
      xToLon: `x >= 1 ? ${180 - EAST_EDGE_EPSILON} : x * 360 - 180`,
      yToLat: "90 - y * 180",
    },
  };
}

/** Wrap a longitude into the half-open interval `[-180, 180)`. **BR-001.** */
function wrapLongitude(lon: number): number {
  if (lon >= LON_BOUNDS.min && lon < LON_BOUNDS.max) {
    return lon;
  }
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}
