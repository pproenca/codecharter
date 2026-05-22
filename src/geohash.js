const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
const BASE32_DECODE = {};
for (let index = 0; index < BASE32.length; index += 1) {
  BASE32_DECODE[BASE32[index]] = index;
}
const GEOHASH_EAST_EDGE_EPSILON = 1e-12;

export function codePlaneDescriptor() {
  return {
    bounds: { x: 0, y: 0, width: 1, height: 1 },
    internalGeoDomain: {
      lat: { min: -90, max: 90 },
      lon: { min: -180, max: 180 },
    },
    transform: {
      xToLon: `x >= 1 ? ${180 - GEOHASH_EAST_EDGE_EPSILON} : x * 360 - 180`,
      yToLat: "90 - y * 180",
    },
  };
}

export function encodeGeohash(lat, lon, precision = 12) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("Latitude and longitude must be finite numbers");
  }
  if (!Number.isInteger(precision) || precision < 1) {
    throw new Error("Geohash precision must be a positive integer");
  }

  let latitude = clamp(lat, -90, 90);
  let longitude = wrapLongitude(lon);
  let latRange = [-90, 90];
  let lonRange = [-180, 180];
  let evenBit = true;
  let bit = 0;
  let charIndex = 0;
  const geohash = [];

  while (geohash.length < precision) {
    if (evenBit) {
      const mid = midpoint(lonRange);
      if (longitude >= mid) {
        charIndex = (charIndex << 1) + 1;
        lonRange[0] = mid;
      } else {
        charIndex <<= 1;
        lonRange[1] = mid;
      }
    } else {
      const mid = midpoint(latRange);
      if (latitude >= mid) {
        charIndex = (charIndex << 1) + 1;
        latRange[0] = mid;
      } else {
        charIndex <<= 1;
        latRange[1] = mid;
      }
    }

    evenBit = !evenBit;
    bit += 1;

    if (bit === 5) {
      geohash.push(BASE32[charIndex]);
      bit = 0;
      charIndex = 0;
    }
  }

  return geohash.join("");
}

export function decodeGeohashBounds(geohash) {
  if (typeof geohash !== "string" || geohash.length === 0) {
    throw new Error("Geohash must be a non-empty string");
  }

  let latRange = [-90, 90];
  let lonRange = [-180, 180];
  let evenBit = true;

  for (const char of geohash) {
    const charIndex = BASE32_DECODE[char];
    if (charIndex === undefined) throw new Error(`Invalid geohash character: ${char}`);

    for (let mask = 16; mask > 0; mask >>= 1) {
      if (evenBit) {
        bisectRange(lonRange, (charIndex & mask) !== 0);
      } else {
        bisectRange(latRange, (charIndex & mask) !== 0);
      }
      evenBit = !evenBit;
    }
  }

  return {
    lat: { min: latRange[0], max: latRange[1] },
    lon: { min: lonRange[0], max: lonRange[1] },
  };
}

export function codePointToGeo(point) {
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
    throw new Error("Code-plane point coordinates must be finite numbers");
  }

  const x = clamp(point.x, 0, 1);
  const y = clamp(point.y, 0, 1);
  const lon = x >= 1 ? 180 - GEOHASH_EAST_EDGE_EPSILON : x * 360 - 180;
  return {
    lon,
    lat: 90 - y * 180,
  };
}

export function geohashForBoundsCenter(bounds, precision = 12) {
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  const geo = codePointToGeo(center);
  return {
    ...geo,
    geohash: encodeGeohash(geo.lat, geo.lon, precision),
  };
}

function midpoint(range) {
  return (range[0] + range[1]) / 2;
}

function bisectRange(range, upperHalf) {
  const mid = midpoint(range);
  if (upperHalf) range[0] = mid;
  else range[1] = mid;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function wrapLongitude(lon) {
  if (lon >= -180 && lon < 180) return lon;
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}
