/**
 * Untyped-value → typed-record coercion helpers. Used to validate
 * `package.json` and config shapes.
 */

import { objectRecord } from "./collections.ts";

export const PACKAGE_DEPENDENCY_SECTIONS = [
  "devDependencies",
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;
export type PackageDependencySection = (typeof PACKAGE_DEPENDENCY_SECTIONS)[number];

export type PackageJsonWithDependencies = {
  name?: string;
  version?: string;
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  [key: string]: unknown;
};

/** Keep only string-valued entries of a record, or `null` if not an object. */
export function stringRecordFromValue(value: unknown): Record<string, string> | null {
  const record = objectRecord(value);
  if (!record) {
    return null;
  }
  const strings: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === "string") {
      strings[key] = entry;
    }
  }
  return strings;
}

/** Return the array iff every element is a string, else `null`. */
export function stringArrayFromValue(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const strings = value.filter((entry) => typeof entry === "string");
  return strings.length === value.length ? strings : null;
}

/** Coerce a parsed value into a sanitized `package.json` shape, or `null`. */
export function packageJsonFromValue(
  value: unknown,
  { sanitizeVersion = false }: { sanitizeVersion?: boolean } = {},
): PackageJsonWithDependencies | null {
  const record = objectRecord(value);
  if (!record) {
    return null;
  }
  const packageJson: PackageJsonWithDependencies = { ...record };
  if (typeof record.name !== "string") {
    delete packageJson.name;
  }
  if (sanitizeVersion && typeof record.version !== "string") {
    delete packageJson.version;
  }
  for (const section of PACKAGE_DEPENDENCY_SECTIONS) {
    const dependencies = stringRecordFromValue(record[section]);
    if (dependencies) {
      packageJson[section] = dependencies;
    } else {
      delete packageJson[section];
    }
  }
  return packageJson;
}
