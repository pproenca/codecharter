import { intersects, roundBounds } from "./geometry.ts";
import type { Bounds } from "./geometry.js";

type NamedPlace = {
  id: string;
  name: string;
  kind: string;
  geometry?: {
    type?: string;
    bounds?: Bounds;
  };
};

type DrawnRectPlace = NamedPlace & {
  geometry: {
    type: "rect";
    bounds: Bounds;
  };
};

type DrawnPlaceEntry = {
  place: DrawnRectPlace;
  index: number;
};

type OrderedOverlap = NamedPlaceOverlap & {
  order: [number, number];
};

export type NamedPlaceOverlap = {
  placeIds: [string, string];
  names: [string, string];
  bounds: Bounds;
};

export function findNamedPlaceOverlaps(places: NamedPlace[]): NamedPlaceOverlap[] {
  const drawn: DrawnPlaceEntry[] = [];
  for (let index = 0; index < places.length; index += 1) {
    const place = places[index];
    if (isDrawnRectPlace(place)) drawn.push({ place, index });
  }
  if (!drawnPlacesAreSorted(drawn)) drawn.sort(compareDrawnPlaces);
  const overlaps: OrderedOverlap[] = [];
  const active: DrawnPlaceEntry[] = [];

  for (const candidate of drawn) {
    const bounds = candidate.place.geometry.bounds;
    removeExpiredActivePlaces(active, bounds.x);

    for (const other of active) {
      if (!intersects(other.place.geometry.bounds, bounds)) continue;
      const [left, right]: [DrawnPlaceEntry, DrawnPlaceEntry] = other.index < candidate.index ? [other, candidate] : [candidate, other];
      overlaps.push({
        order: [left.index, right.index],
        placeIds: [left.place.id, right.place.id],
        names: [left.place.name, right.place.name],
        bounds: intersectionBounds(left.place.geometry.bounds, right.place.geometry.bounds),
      });
    }

    active.push(candidate);
  }

  if (!overlapsAreSorted(overlaps)) overlaps.sort(compareOverlaps);
  return overlaps.map(({ order, ...overlap }) => overlap);
}

function isDrawnRectPlace(place: NamedPlace | undefined): place is DrawnRectPlace {
  return place?.kind === "drawnSelection"
    && place.geometry?.type === "rect"
    && Boolean(place.geometry.bounds);
}

function removeExpiredActivePlaces(active: DrawnPlaceEntry[], x: number): void {
  let write = 0;
  for (let read = 0; read < active.length; read += 1) {
    const entry = active[read];
    if (!entry) continue;
    const bounds = entry.place.geometry.bounds;
    if (bounds.x + bounds.width <= x) continue;
    active[write] = entry;
    write += 1;
  }
  active.length = write;
}

function drawnPlacesAreSorted(drawn: DrawnPlaceEntry[]): boolean {
  for (let index = 1; index < drawn.length; index += 1) {
    const previous = drawn[index - 1];
    const current = drawn[index];
    if (previous && current && compareDrawnPlaces(previous, current) > 0) return false;
  }
  return true;
}

function compareDrawnPlaces(a: DrawnPlaceEntry, b: DrawnPlaceEntry): number {
  return a.place.geometry.bounds.x - b.place.geometry.bounds.x || a.index - b.index;
}

function overlapsAreSorted(overlaps: OrderedOverlap[]): boolean {
  for (let index = 1; index < overlaps.length; index += 1) {
    const previous = overlaps[index - 1];
    const current = overlaps[index];
    if (previous && current && compareOverlaps(previous, current) > 0) return false;
  }
  return true;
}

function compareOverlaps(a: OrderedOverlap, b: OrderedOverlap): number {
  return a.order[0] - b.order[0] || a.order[1] - b.order[1];
}

function intersectionBounds(a: Bounds, b: Bounds): Bounds {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  return roundBounds({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
}
