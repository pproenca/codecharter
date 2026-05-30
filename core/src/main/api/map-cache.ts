/**
 * Parsed-map cache + map version for the localhost API.
 *
 * HARDENING (BR-037): the map file may be untrusted, so every
 * read validates the schema and is keyed by an `mtimeNs:size` signature — a
 * changed file is re-parsed, an unchanged one is served from cache.
 */

import { readFile, stat } from "node:fs/promises";
import { isCodecharterMap } from "../resolver.ts";
import type { CodecharterMap } from "../resolver.ts";
import type { ServerState } from "./context.ts";
import { httpError } from "./http.ts";

export async function loadMap(state: ServerState): Promise<CodecharterMap> {
  const stats = await stat(state.mapPath, { bigint: true });
  const signature = `${stats.mtimeNs}:${stats.size}`;
  if (state.mapCache?.signature === signature) {
    return state.mapCache.map;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(state.mapPath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw httpError(500, "Map file is not valid JSON; run `codecharter generate`");
    }
    throw error;
  }
  if (!isCodecharterMap(parsed)) {
    throw httpError(500, "Map file is missing files/folders; run `codecharter generate`");
  }
  state.mapCache = { signature, map: parsed };
  return parsed;
}

export async function loadMapVersion(state: ServerState): Promise<{ version: string }> {
  const stats = await stat(state.mapPath, { bigint: true });
  return { version: `${stats.mtimeNs}:${stats.size}` };
}
