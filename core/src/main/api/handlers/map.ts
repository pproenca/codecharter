/**
 * Map-domain API handlers: the codemap itself, its version, tile index/tiles,
 * visible prefixes, address resolution, and bounded source reads. Each reads the
 * validated codemap via the cache and writes a JSON response.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { resolveRealPathWithinRoot } from "../../path-containment.ts";
import { normalizePathForMap, resolveAddress } from "../../resolver.ts";
import { readSourceRange } from "../../source.ts";
import { buildTileIndex, getTile, visiblePrefixes } from "../../tiles.ts";
import { loadCodemap, loadMapVersion } from "../codemap-cache.ts";
import type { ServerState } from "../context.ts";
import { httpError, optionalNumber, requiredParam, sendJson } from "../http.ts";
import { assertWithinRoot, mapLevelParam } from "../parse.ts";

export async function getMapApi(
  state: ServerState,
  _request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  sendJson(response, 200, await loadCodemap(state));
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
  const codemap = await loadCodemap(state);
  const level = mapLevelParam(url.searchParams.get("level") ?? "file");
  const prefix = url.searchParams.get("prefix");
  sendJson(
    response,
    200,
    prefix ? getTile(codemap, { level, prefix }) : buildTileIndex(codemap, level),
  );
}

export async function getPrefixesApi(
  state: ServerState,
  _request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const codemap = await loadCodemap(state);
  const level = mapLevelParam(url.searchParams.get("level") ?? "file");
  sendJson(response, 200, { level, prefixes: visiblePrefixes(codemap, level) });
}

export async function getResolveApi(
  state: ServerState,
  _request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const codemap = await loadCodemap(state);
  const path = requiredParam(url, "path");
  const lineStart = optionalNumber(url.searchParams.get("lineStart"));
  const lineEnd = optionalNumber(url.searchParams.get("lineEnd"));
  const columnStart = optionalNumber(url.searchParams.get("columnStart"));
  const columnEnd = optionalNumber(url.searchParams.get("columnEnd"));
  sendJson(
    response,
    200,
    resolveAddress(codemap, {
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
  const codemap = await loadCodemap(state);
  const path = requiredParam(url, "path");
  const key = normalizePathForMap(path);
  // HARDENING (CWE-1321): an untrusted codemap key like "__proto__" must not
  // reach the object prototype; require an own property before indexing.
  const file = Object.hasOwn(codemap.files, key) ? codemap.files[key] : undefined;
  if (!file) {
    throw httpError(404, `No source file found for path: ${path}`);
  }
  // HARDENING (CWE-22): with an untrusted codemap, a poisoned key like
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
