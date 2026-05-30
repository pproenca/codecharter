/**
 * Map-domain API handlers: the map itself, its version, tile index/tiles,
 * visible prefixes, address resolution, and bounded source reads. Each reads the
 * validated map via the cache and writes a JSON response.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { resolveRealPathWithinRoot } from "../../path-containment.ts";
import { normalizePathForMap, resolveAddress } from "../../resolver.ts";
import { readSourceRange } from "../../source.ts";
import { buildTileIndex, getTile, visiblePrefixes } from "../../tiles.ts";
import type { ServerState } from "../context.ts";
import { httpError, optionalNumber, requiredParam, sendJson } from "../http.ts";
import { loadMap, loadMapVersion } from "../map-cache.ts";
import { assertWithinRoot, mapLevelParam } from "../parse.ts";

export async function getMapApi(
  state: ServerState,
  _request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  sendJson(response, 200, await loadMap(state));
}

export async function getMapVersionApi(
  state: ServerState,
  _request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  sendJson(response, 200, await loadMapVersion(state));
}

export async function getTilesApi(
  state: ServerState,
  _request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const map = await loadMap(state);
  const level = mapLevelParam(url.searchParams.get("level") ?? "file");
  const prefix = url.searchParams.get("prefix");
  sendJson(response, 200, prefix ? getTile(map, { level, prefix }) : buildTileIndex(map, level));
}

export async function getPrefixesApi(
  state: ServerState,
  _request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const map = await loadMap(state);
  const level = mapLevelParam(url.searchParams.get("level") ?? "file");
  sendJson(response, 200, { level, prefixes: visiblePrefixes(map, level) });
}

export async function getResolveApi(
  state: ServerState,
  _request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const map = await loadMap(state);
  const path = requiredParam(url, "path");
  const lineStart = optionalNumber(url.searchParams.get("lineStart"));
  const lineEnd = optionalNumber(url.searchParams.get("lineEnd"));
  const columnStart = optionalNumber(url.searchParams.get("columnStart"));
  const columnEnd = optionalNumber(url.searchParams.get("columnEnd"));
  sendJson(
    response,
    200,
    resolveAddress(map, {
      path,
      ...(lineStart === undefined ? {} : { lineStart }),
      ...(lineEnd === undefined ? {} : { lineEnd }),
      ...(columnStart === undefined ? {} : { columnStart }),
      ...(columnEnd === undefined ? {} : { columnEnd }),
    }),
  );
}

export async function getSourceApi(
  state: ServerState,
  _request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const map = await loadMap(state);
  const path = requiredParam(url, "path");
  const key = normalizePathForMap(path);
  // HARDENING (CWE-1321): an untrusted map key like "__proto__" must not
  // reach the object prototype; require an own property before indexing.
  const file = Object.hasOwn(map.files, key) ? map.files[key] : undefined;
  if (!file) {
    throw httpError(404, `No source file found for path: ${path}`);
  }
  // HARDENING (CWE-22): with an untrusted map, a poisoned key like
  // "../../etc/passwd" must not escape root. Confine the resolved path.
  assertWithinRoot(state.root, file.path);
  // HARDENING (CWE-367): resolve the real path ONCE and read from that exact
  // path, so the containment check and the read observe the same inode.
  const realPath = await resolveRealPathWithinRoot(state.root, file.path);
  if (!realPath) {
    throw httpError(400, "Source path escapes repository root");
  }
  const lineEnd = optionalNumber(url.searchParams.get("lineEnd"));
  sendJson(
    response,
    200,
    await readSourceRange(realPath, file, {
      lineStart: optionalNumber(url.searchParams.get("lineStart")) ?? 1,
      ...(lineEnd === undefined ? {} : { lineEnd }),
    }),
  );
}
