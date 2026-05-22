import { intersects, roundBounds } from "./geometry.js";

export function findNamedPlaceOverlaps(places) {
  const drawn = [];
  for (let index = 0; index < places.length; index += 1) {
    const place = places[index];
    if (place.kind === "drawnSelection" && place.geometry?.type === "rect") drawn.push({ place, index });
  }
  if (!drawnPlacesAreSorted(drawn)) drawn.sort(compareDrawnPlaces);
  const overlaps = [];
  const active = [];

  for (const candidate of drawn) {
    const bounds = candidate.place.geometry.bounds;
    removeExpiredActivePlaces(active, bounds.x);

    for (const other of active) {
      if (!intersects(other.place.geometry.bounds, bounds)) continue;
      const [left, right] = other.index < candidate.index ? [other, candidate] : [candidate, other];
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
  const results = [];
  for (const { order, ...overlap } of overlaps) {
    results.push(overlap);
  }
  return results;
}

function removeExpiredActivePlaces(active, x) {
  let write = 0;
  for (let read = 0; read < active.length; read += 1) {
    const bounds = active[read].place.geometry.bounds;
    if (bounds.x + bounds.width <= x) continue;
    active[write] = active[read];
    write += 1;
  }
  active.length = write;
}

function drawnPlacesAreSorted(drawn) {
  for (let index = 1; index < drawn.length; index += 1) {
    if (compareDrawnPlaces(drawn[index - 1], drawn[index]) > 0) return false;
  }
  return true;
}

function compareDrawnPlaces(a, b) {
  return a.place.geometry.bounds.x - b.place.geometry.bounds.x || a.index - b.index;
}

function overlapsAreSorted(overlaps) {
  for (let index = 1; index < overlaps.length; index += 1) {
    if (compareOverlaps(overlaps[index - 1], overlaps[index]) > 0) return false;
  }
  return true;
}

function compareOverlaps(a, b) {
  return a.order[0] - b.order[0] || a.order[1] - b.order[1];
}

function intersectionBounds(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  return roundBounds({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
}
