/**
 * Ordering & record helpers for `@codecharter/core`.
 *
 * Pure subset of the legacy `src/util.ts` grab-bag — the sort/compare helpers
 * the deterministic layout (BR-009) and resolution rely on. The I/O-oriented
 * helpers (`packageJsonFromValue`, `mapConcurrent`, error guards) stay in legacy
 * until their consuming modules are transformed.
 */

/** Locale-aware string comparison — the deterministic tiebreak for layout order (BR-009). */
export function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

/**
 * Sort `values` in place only when not already ordered. `toSorted` satisfies
 * the lint rule while the splice preserves the legacy mutation contract.
 */
export function sortIfNeeded<T>(values: T[], compare: (left: T, right: T) => number): T[] {
  if (valuesAreSorted(values, compare)) {
    return values;
  }
  const sorted = values.toSorted(compare);
  for (let index = 0; index < sorted.length; index += 1) {
    values[index] = sorted[index]!;
  }
  values.length = sorted.length;
  return values;
}

/** Deduplicate and sort an iterable of strings. */
export function sortedUniqueStrings(values: Iterable<string>): string[] {
  return sortIfNeeded([...(values instanceof Set ? values : new Set(values))], compareStrings);
}

/** Coerce a value to a plain own-property record, or `null` if it isn't an object. */
export function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

/** Yield a record's defined own values, skipping inherited keys and `undefined`. */
export function* objectValues<T>(values: Record<string, T>): Generator<T> {
  for (const key in values) {
    if (!Object.hasOwn(values, key)) {
      continue;
    }
    const value = values[key];
    if (value !== undefined) {
      yield value;
    }
  }
}

function valuesAreSorted<T>(values: T[], compare: (left: T, right: T) => number): boolean {
  for (let index = 1; index < values.length; index += 1) {
    if (compare(values[index - 1]!, values[index]!) > 0) {
      return false;
    }
  }
  return true;
}

/**
 * Map over items with a bounded number of concurrent workers, preserving input
 * order in the result array. Used by the scanner to read files in parallel.
 */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  map: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  results.length = items.length;
  let next = 0;
  const workerCount = Math.max(1, Math.min(items.length, concurrency));
  const workers = Array.from({ length: workerCount }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await map(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}
