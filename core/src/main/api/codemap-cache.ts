/**
 * Parsed-codemap cache + map version for the localhost API.
 *
 * HARDENING (BR-037 + debt #4): the map file may be untrusted (Q4), so every
 * read validates the schema and is keyed by an `mtimeNs:size` signature — a
 * changed file is re-parsed, an unchanged one is served from cache.
 */

import { readFile, stat } from "node:fs/promises";
import { isCodecharterCodemap } from "../resolver.ts";
import type { CodecharterCodemap } from "../resolver.ts";
import type { ServerState } from "./context.ts";
import { httpError } from "./http.ts";

export async function loadCodemap(state: ServerState): Promise<CodecharterCodemap> {
  const stats = await stat(state.mapPath, { bigint: true });
  const signature = `${stats.mtimeNs}:${stats.size}`;
  if (state.codemapCache?.signature === signature) {
    return state.codemapCache.codemap;
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
  if (!isCodecharterCodemap(parsed)) {
    throw httpError(500, "Map file is missing files/folders; run `codecharter generate`");
  }
  state.codemapCache = { signature, codemap: parsed };
  return parsed;
}

export async function loadMapVersion(state: ServerState): Promise<{ version: string }> {
  const stats = await stat(state.mapPath, { bigint: true });
  return { version: `${stats.mtimeNs}:${stats.size}` };
}
