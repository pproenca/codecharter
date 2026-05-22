export type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Point = {
  x: number;
  y: number;
};

export function intersects(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y;
}

export function containsPoint(bounds: Bounds, point: Point): boolean {
  return point.x >= bounds.x
    && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y
    && point.y <= bounds.y + bounds.height;
}

export function normalizeRect(rect: Bounds): Bounds {
  const x1 = Math.min(rect.x, rect.x + rect.width);
  const x2 = Math.max(rect.x, rect.x + rect.width);
  const y1 = Math.min(rect.y, rect.y + rect.height);
  const y2 = Math.max(rect.y, rect.y + rect.height);
  return roundBounds({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
}

export function clampBounds(bounds: Bounds): Bounds {
  const x1 = clamp(bounds.x, 0, 1);
  const y1 = clamp(bounds.y, 0, 1);
  const x2 = clamp(bounds.x + bounds.width, 0, 1);
  const y2 = clamp(bounds.y + bounds.height, 0, 1);
  return roundBounds({ x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) });
}

export function roundBounds(bounds: Bounds): Bounds {
  return {
    x: round(bounds.x),
    y: round(bounds.y),
    width: round(bounds.width),
    height: round(bounds.height),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Number(value.toFixed(12));
}
