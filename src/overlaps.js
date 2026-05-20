import { intersects, roundBounds } from "./geometry.js";

export function findNamedPlaceOverlaps(places) {
  const drawn = places.filter((place) => place.kind === "drawnSelection" && place.geometry?.type === "rect");
  const overlaps = [];

  for (let i = 0; i < drawn.length; i += 1) {
    for (let j = i + 1; j < drawn.length; j += 1) {
      const a = drawn[i];
      const b = drawn[j];
      if (!intersects(a.geometry.bounds, b.geometry.bounds)) continue;
      overlaps.push({
        placeIds: [a.id, b.id],
        names: [a.name, b.name],
        bounds: intersectionBounds(a.geometry.bounds, b.geometry.bounds),
      });
    }
  }

  return overlaps;
}

function intersectionBounds(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  return roundBounds({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
}
