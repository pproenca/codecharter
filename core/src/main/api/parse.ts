/**
 * Shared, pure request-parsing primitives for the localhost API: typed string
 * field extraction, numeric coercion, map-level validation, and root-containment
 * checks. No server state — domain-shaped body builders live with their handler
 * module; only the cross-cutting leaves live here.
 */

import { resolve, sep } from "node:path";
import { MAP_LEVELS } from "../levels.ts";
import type { MapLevel } from "../levels.ts";
import type { JsonObject } from "./context.ts";
import { httpError } from "./http.ts";

export function stringFields<T extends string>(
  body: JsonObject,
  fields: readonly T[],
): Partial<Record<T, string>> {
  const result: Partial<Record<T, string>> = {};
  for (const key of fields) {
    if (typeof body[key] === "string") {
      result[key] = body[key];
    }
  }
  return result;
}

export function numberFromValue(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Expected finite number, received: ${String(value)}`);
  }
  return number;
}

export function isMapLevel(value: string): value is MapLevel {
  return Object.hasOwn(MAP_LEVELS, value);
}

export function mapLevelParam(value: string): MapLevel {
  if (isMapLevel(value)) {
    return value;
  }
  throw httpError(400, `Unknown map level: ${value}`);
}

// HARDENING (CWE-22): with an untrusted map a poisoned file path must not
// escape root. Lexical containment check before any filesystem access.
export function assertWithinRoot(root: string, candidate: string): void {
  const full = resolve(root, candidate);
  if (full !== root && !full.startsWith(root + sep)) {
    throw httpError(400, "Path escapes repository root");
  }
}
