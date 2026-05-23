export const PACKAGE_DEPENDENCY_SECTIONS = ["devDependencies", "dependencies", "optionalDependencies", "peerDependencies"] as const;
export type PackageDependencySection = typeof PACKAGE_DEPENDENCY_SECTIONS[number];
export type PackageJsonWithDependencies = {
  name?: string;
  version?: string;
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  [key: string]: unknown;
};

export function round(value: number): number {
  return Number(value.toFixed(12));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function compareStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

export function sortIfNeeded<T>(values: T[], compare: (left: T, right: T) => number): T[] {
  return valuesAreSorted(values, compare) ? values : values.sort(compare);
}

export function sortedUniqueStrings(values: Iterable<string>): string[] {
  return sortIfNeeded([...(values instanceof Set ? values : new Set(values))], compareStrings);
}

export async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  map: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
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

function valuesAreSorted<T>(values: T[], compare: (left: T, right: T) => number): boolean {
  for (let index = 1; index < values.length; index += 1) {
    if (compare(values[index - 1]!, values[index]!) > 0) return false;
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

export function stringRecordFromValue(value: unknown): Record<string, string> | null {
  const record = objectRecord(value);
  if (!record) return null;
  const strings: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === "string") strings[key] = entry;
  }
  return strings;
}

export function stringArrayFromValue(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const strings = value.filter((entry) => typeof entry === "string");
  return strings.length === value.length ? strings : null;
}

export function packageJsonFromValue(
  value: unknown,
  { sanitizeVersion = false }: { sanitizeVersion?: boolean } = {},
): PackageJsonWithDependencies | null {
  const record = objectRecord(value);
  if (!record) return null;
  const packageJson: PackageJsonWithDependencies = { ...record };
  if (typeof record.name !== "string") delete packageJson.name;
  if (sanitizeVersion && typeof record.version !== "string") delete packageJson.version;
  for (const section of PACKAGE_DEPENDENCY_SECTIONS) {
    const dependencies = stringRecordFromValue(record[section]);
    if (dependencies) packageJson[section] = dependencies;
    else delete packageJson[section];
  }
  return packageJson;
}

export function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
