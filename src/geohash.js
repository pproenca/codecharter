const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
const GEOHASH_EAST_EDGE_EPSILON = 1e-12;

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
  let geohash = "";

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
      geohash += BASE32[charIndex];
      bit = 0;
      charIndex = 0;
    }
  }

  return geohash;
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function wrapLongitude(lon) {
  if (lon >= -180 && lon < 180) return lon;
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}
