import { intersects, roundBounds } from "./geometry.js";

export function findNamedPlaceOverlaps(places) {
  const drawn = places
    .map((place, index) => ({ place, index }))
    .filter(({ place }) => place.kind === "drawnSelection" && place.geometry?.type === "rect")
    .sort((a, b) => a.place.geometry.bounds.x - b.place.geometry.bounds.x || a.index - b.index);
  const overlaps = [];
  const active = [];

  for (const candidate of drawn) {
    const bounds = candidate.place.geometry.bounds;
    for (let index = active.length - 1; index >= 0; index -= 1) {
      if (active[index].place.geometry.bounds.x + active[index].place.geometry.bounds.width <= bounds.x) {
        active.splice(index, 1);
      }
    }

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

  return overlaps
    .sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1])
    .map(({ order, ...overlap }) => overlap);
}

function intersectionBounds(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  return roundBounds({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
}
