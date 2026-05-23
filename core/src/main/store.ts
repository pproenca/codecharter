/**
 * Atomic JSON persistence (**BR-055, P0**): write to a unique temp file then
 * rename over the target, so a crashed write never leaves a corrupt file.
 * Reads tolerate a missing file by returning a caller-supplied fallback.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isErrnoException } from "./errors.ts";

export async function readJson(path: string): Promise<unknown>;
export async function readJson<T>(path: string, fallback: T): Promise<T>;
export async function readJson(path: string, fallback?: unknown): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}
