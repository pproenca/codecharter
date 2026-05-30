/**
 * Geocoding value types for `@codecharter/core`.
 *
 * Owns the `Geo*` types that form the geohash module's public surface;
 * `Point`/`Bounds` live in `geometry.ts`.
 */

import type { Bounds } from "./geometry.ts";

/** A geographic coordinate the code plane is internally projected onto. */
export type GeoCoordinate = {
  lat: number;
  lon: number;
};

/** The lat/lon bounding box a geohash cell covers. */
export type GeohashBounds = {
  lat: { min: number; max: number };
  lon: { min: number; max: number };
};

/** A geographic coordinate plus its encoded geohash address. */
export type GeohashedCoordinate = GeoCoordinate & {
  geohash: string;
};

/**
 * Self-describing metadata for the code-plane → lat/lon projection, embedded in
 * the generated map so consumers can reproduce addresses without this code.
 */
export type CodePlaneDescriptor = {
  bounds: Bounds;
  internalGeoDomain: {
    lat: { min: number; max: number };
    lon: { min: number; max: number };
  };
  transform: {
    xToLon: string;
    yToLat: string;
  };
};
