/**
 * Local HTTP server + JSON API over a generated codemap.
 *
 * Behavior for legitimate requests is preserved from legacy (proven by a
 * fixture differential vs the old server). Per Open Question **Q4 = the codemap
 * may be untrusted**, this version adds DELIBERATE hardening (the brief's Phase-3
 * security work), each marked `// HARDENING`:
 *   - `Host` allowlist (DNS-rebinding source-exfiltration — High)
 *   - codemap schema validation + mtime:size cache (BR-037 + debt #4)
 *   - `/api/source` and static path containment within root (CWE-22)
 *   - request-body size cap (DoS — Medium)
 *
 * NOTE: this remains one module (the legacy god-file); splitting into
 * `routes/`/`handlers/` is a follow-up the brief tracks separately.
 */

import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createActivityStore } from "./activity-store.ts";
import type {
  ApiHandler,
  ApiRoute,
  ApiRouteMatch,
  MatchedApiRoute,
  ServerState,
} from "./api/context.ts";
import { deleteActivityApi, getActivityApi, postActivityApi } from "./api/handlers/activity.ts";
import {
  getMapApi,
  getMapVersionApi,
  getPrefixesApi,
  getResolveApi,
  getSourceApi,
  getTilesApi,
} from "./api/handlers/map.ts";
import {
  deleteAnnotationApi,
  getAnnotationApi,
  getAnnotationsApi,
  getNamedPlacesApi,
  postAnnotationsApi,
  postNamedPlacesApi,
  postSelectionResolveApi,
  putAnnotationApi,
} from "./api/handlers/named-places.ts";
import { assertLocalHost, assertSafeMutationRequest } from "./api/hardening.ts";
import { httpError, sendJson } from "./api/http.ts";
import { objectRecord } from "./collections.ts";
import { isErrnoException } from "./errors.ts";
import { ACTIVITY_ARCHIVE_FILE, CONFIG_FILE, NAMED_PLACES_FILE } from "./paths.ts";
import { readJson } from "./store.ts";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const BUNDLED_PUBLIC_ROOT = fileURLToPath(new URL("../public", import.meta.url));
const DEFAULT_PORT_SEARCH_LIMIT = 20;
const DEFAULT_ACTIVITY_ARCHIVE = ACTIVITY_ARCHIVE_FILE;

type ServerConfig = {
  activityPath?: string;
  agents?: { codex?: { activityPath?: string } };
};

type ServerOptions = {
  root: string;
  mapPath: string;
  port: number;
  activityArchivePath?: string;
  activityFlushIntervalMs?: number;
  publicRoot?: string;
  portSearchLimit?: number;
};

const API_ROUTES = Object.freeze([
  apiRoute("GET", "/api/map", getMapApi),
  apiRoute("GET", "/api/map-version", getMapVersionApi),
  apiRoute("GET", "/api/tiles", getTilesApi),
  apiRoute("GET", "/api/prefixes", getPrefixesApi),
  apiRoute("GET", "/api/resolve", getResolveApi),
  apiRoute("GET", "/api/source", getSourceApi),
  apiRoute("GET", "/api/named-places", getNamedPlacesApi),
  apiRoute("POST", "/api/named-places", postNamedPlacesApi),
  apiRoute("GET", "/api/annotations", getAnnotationsApi),
  apiRoute("GET", "/api/annotations/", getAnnotationApi, { prefix: true }),
  apiRoute("PUT", "/api/annotations/", putAnnotationApi, { prefix: true }),
  apiRoute("DELETE", "/api/annotations/", deleteAnnotationApi, { prefix: true }),
  apiRoute("POST", "/api/annotations", postAnnotationsApi),
  apiRoute("POST", "/api/selections/resolve", postSelectionResolveApi),
  apiRoute("GET", "/api/activity", getActivityApi),
  apiRoute("DELETE", "/api/activity", deleteActivityApi),
  apiRoute("POST", "/api/activity", postActivityApi),
]);
export async function startServer({
  root,
  mapPath,
  port,
  activityArchivePath,
  activityFlushIntervalMs,
  publicRoot,
  portSearchLimit = DEFAULT_PORT_SEARCH_LIMIT,
}: ServerOptions): Promise<Server> {
  const resolvedRoot = resolve(root);
  const resolvedMapPath = isAbsolute(mapPath) ? mapPath : resolve(resolvedRoot, mapPath);
  const resolvedActivityArchivePath =
    activityArchivePath === undefined
      ? await configuredActivityArchivePath(resolvedRoot)
      : isAbsolute(activityArchivePath)
        ? activityArchivePath
        : resolve(resolvedRoot, activityArchivePath);
  const resolvedPublicRoot =
    publicRoot === undefined
      ? resolve(await defaultPublicRoot(resolvedRoot))
      : isAbsolute(publicRoot)
        ? resolve(publicRoot)
        : resolve(resolvedRoot, publicRoot);
  const state: ServerState = {
    root: resolvedRoot,
    mapPath: resolvedMapPath,
    publicRoot: resolvedPublicRoot,
    namedPlacesPath: join(resolvedRoot, NAMED_PLACES_FILE),
    namedPlacesMutation: Promise.resolve(),
    activityArchivePath: resolvedActivityArchivePath,
    activityStore: createActivityStore({
      archivePath: resolvedActivityArchivePath,
      ...(activityFlushIntervalMs === undefined
        ? {}
        : { flushIntervalMs: activityFlushIntervalMs }),
    }),
  };

  const server = createServer((request, response) => {
    handleRequest(state, request, response).catch((error) => {
      const statusCode =
        error instanceof Error && "statusCode" in error ? Number(error.statusCode) : 500;
      sendJson(response, statusCode, {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });

  const actualPort = await listenOnAvailablePort(server, { port, portSearchLimit });

  server.on("close", () => {
    state.activityStore.close().catch((error) => {
      console.warn(`warning: activity-archive-close-flush-skipped error=${error.message}`);
    });
  });

  console.error(`server: http://127.0.0.1:${actualPort}`);
  return server;
}

async function defaultPublicRoot(root: string): Promise<string> {
  const candidates = [
    BUNDLED_PUBLIC_ROOT,
    join(root, "dist", "public"),
    join(root, "viewer", "dist"),
  ];
  for (const candidate of candidates) {
    if (await hasStaticShell(candidate)) {
      return candidate;
    }
  }
  return BUNDLED_PUBLIC_ROOT;
}

async function hasStaticShell(publicRoot: string): Promise<boolean> {
  try {
    return (await stat(join(publicRoot, "index.html"))).isFile();
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function configuredActivityArchivePath(root: string): Promise<string> {
  const config = serverConfigFromValue(await readJson(join(root, CONFIG_FILE), {}));
  const configured =
    config.agents?.codex?.activityPath ?? config.activityPath ?? DEFAULT_ACTIVITY_ARCHIVE;
  return isAbsolute(configured) ? configured : resolve(root, configured);
}

async function listenOnAvailablePort(
  server: Server,
  { port, portSearchLimit }: { port: number; portSearchLimit: number },
): Promise<number> {
  if (port === 0) {
    await listenOnce(server, port);
    return serverPort(server.address());
  }

  const lastPort = port + Math.max(0, portSearchLimit);
  for (let candidate = port; candidate <= lastPort; candidate += 1) {
    try {
      await listenOnce(server, candidate);
      return candidate;
    } catch (error) {
      if (!isErrnoException(error) || error.code !== "EADDRINUSE" || candidate === lastPort) {
        throw error;
      }
    }
  }

  throw new Error(`No available port found from ${port} to ${lastPort}`);
}

async function listenOnce(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolveListen, reject) => {
    function cleanup() {
      server.off("error", onError);
    }
    function onError(error: Error) {
      cleanup();
      reject(error);
    }
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      cleanup();
      resolveListen();
    });
  });
}

async function handleRequest(
  state: ServerState,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  assertLocalHost(request); // HARDENING: reject non-localhost Host (DNS rebinding)
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (url.pathname.startsWith("/api/")) {
    await handleApi(state, request, response, url);
    return;
  }

  await serveStatic(state, response, url.pathname === "/" ? "/index.html" : url.pathname);
}

async function handleApi(
  state: ServerState,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const match = matchingApiRoute(request, url);
  if (match) {
    assertSafeMutationRequest(request);
    await match.route.handle(state, request, response, url, match);
    return;
  }

  if (knownApiPath(url)) {
    throw httpError(405, "Method not allowed");
  }
  throw httpError(404, "Not found");
}

function matchingApiRoute(request: IncomingMessage, url: URL): MatchedApiRoute | null {
  for (const route of API_ROUTES) {
    const match = matchApiRoute(route, request, url);
    if (match) {
      return { route, ...match };
    }
  }
  return null;
}

function knownApiPath(url: URL): boolean {
  return API_ROUTES.some((route) => matchApiPath(route, url.pathname));
}

function apiRoute(
  method: string,
  pattern: string,
  handle: ApiHandler,
  { prefix = false }: { prefix?: boolean } = {},
): ApiRoute {
  return { method, pattern, handle, prefix };
}

function matchApiRoute(route: ApiRoute, request: IncomingMessage, url: URL): ApiRouteMatch | null {
  if (route.method !== request.method) {
    return null;
  }
  return matchApiPath(route, url.pathname);
}

function matchApiPath(route: ApiRoute, pathname: string): ApiRouteMatch | null {
  if (!route.prefix) {
    return pathname === route.pattern ? { params: {} } : null;
  }
  if (!pathname.startsWith(route.pattern) || pathname.length === route.pattern.length) {
    return null;
  }
  return { params: { rest: pathname.slice(route.pattern.length) } };
}

async function serveStatic(
  state: ServerState,
  response: ServerResponse,
  pathname: string,
): Promise<void> {
  // HARDENING (CWE-22): canonical-path containment instead of a substring check.
  const path = resolve(state.publicRoot, `.${pathname}`);
  if (path !== state.publicRoot && !path.startsWith(state.publicRoot + sep)) {
    throw httpError(400, "Invalid path");
  }
  try {
    const content = await readFile(path);
    response.writeHead(200, {
      "content-type": MIME_TYPES[extname(path)] ?? "application/octet-stream",
    });
    response.end(content);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      throw httpError(404, "Not found");
    }
    throw error;
  }
}

function serverPort(address: string | AddressInfo | null): number {
  if (!address || typeof address === "string") {
    throw new Error("Server did not expose a TCP port");
  }
  return address.port;
}

function serverConfigFromValue(value: unknown): ServerConfig {
  const record = objectRecord(value);
  if (!record) {
    return {};
  }
  const codex = objectRecord(objectRecord(record.agents)?.codex);
  const config: ServerConfig = {};
  if (typeof record.activityPath === "string") {
    config.activityPath = record.activityPath;
  }
  if (codex) {
    const codexConfig: NonNullable<NonNullable<ServerConfig["agents"]>["codex"]> = {};
    if (typeof codex.activityPath === "string") {
      codexConfig.activityPath = codex.activityPath;
    }
    config.agents = { codex: codexConfig };
  }
  return config;
}
