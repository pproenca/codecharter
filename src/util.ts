export function round(value: number): number {
  return Number(value.toFixed(12));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function stringsAreSorted(values: string[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous !== undefined && current !== undefined && previous.localeCompare(current) > 0) return false;
  }
  return true;
}

export function* objectValues<T>(values: Record<string, T>): Generator<T> {
  for (const key in values) {
    if (!Object.hasOwn(values, key)) continue;
    const value = values[key];
    if (value !== undefined) yield value;
  }
}

export function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : null;
}
