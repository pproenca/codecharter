import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createActivityEvent } from "./activity.js";
import { createActivityStore } from "./activity-store.js";
import { findNamedPlaceOverlaps } from "./overlaps.js";
import { normalizePathForMap, resolveAddress } from "./resolver.js";
import { createMapAnnotation, createNamedAddress, createNamedSelection, refreshPlaceResolution, resolveSelection } from "./selections.js";
import { readSourceRange } from "./source.js";
import { readJson, writeJson } from "./store.js";
import { buildTileIndex, getTile, visiblePrefixes } from "./tiles.js";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const BUNDLED_PUBLIC_ROOT = fileURLToPath(new URL("../public", import.meta.url));
const DEFAULT_PORT_SEARCH_LIMIT = 20;
const DEFAULT_ACTIVITY_ARCHIVE = ".codecharter/activity.jsonl";

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
  publicRoot = BUNDLED_PUBLIC_ROOT,
  portSearchLimit = DEFAULT_PORT_SEARCH_LIMIT,
}) {
  const resolvedActivityArchivePath = activityArchivePath ?? await configuredActivityArchivePath(root);
  const state = {
    root,
    mapPath,
    publicRoot,
    namedPlacesPath: join(root, ".codecharter", "named-places.json"),
    activityArchivePath: resolvedActivityArchivePath,
    activityStore: createActivityStore({
      archivePath: resolvedActivityArchivePath,
      flushIntervalMs: activityFlushIntervalMs,
    }),
  };

  const server = createServer((request, response) => {
    handleRequest(state, request, response).catch((error) => {
      sendJson(response, error.statusCode ?? 500, { error: error.message });
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

async function configuredActivityArchivePath(root) {
  const config = await readJson(join(root, ".codecharter", "config.json"), {});
  const configured = config.agents?.codex?.activityPath ?? config.activityPath ?? DEFAULT_ACTIVITY_ARCHIVE;
  return isAbsolute(configured) ? configured : resolve(root, configured);
}

async function listenOnAvailablePort(server, { port, portSearchLimit }) {
  if (port === 0) {
    await listenOnce(server, port);
    return server.address().port;
  }

  const lastPort = port + Math.max(0, portSearchLimit);
  for (let candidate = port; candidate <= lastPort; candidate += 1) {
    try {
      await listenOnce(server, candidate);
      return candidate;
    } catch (error) {
      if (error.code !== "EADDRINUSE" || candidate === lastPort) throw error;
    }
  }

  throw new Error(`No available port found from ${port} to ${lastPort}`);
}

async function listenOnce(server, port) {
  await new Promise((resolve, reject) => {
    function cleanup() {
      server.off("error", onError);
    }
    function onError(error) {
      cleanup();
      reject(error);
    }
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      cleanup();
      resolve();
    });
  });
}

async function handleRequest(state, request, response) {
  const url = new URL(request.url, "http://127.0.0.1");

  if (url.pathname.startsWith("/api/")) {
    await handleApi(state, request, response, url);
    return;
  }

  await serveStatic(state, response, url.pathname === "/" ? "/index.html" : url.pathname);
}

async function handleApi(state, request, response, url) {
  const match = matchingApiRoute(request, url);
  if (match) {
    await match.route.handle(state, request, response, url, match);
    return;
  }

  if (knownApiPath(url)) throw httpError(405, "Method not allowed");
  throw httpError(404, "Not found");
}

function matchingApiRoute(request, url) {
  for (const route of API_ROUTES) {
    const match = matchApiRoute(route, request, url);
    if (match) return { route, ...match };
  }
  return null;
}

function knownApiPath(url) {
  return API_ROUTES.some((route) => matchApiPath(route, url.pathname));
}

function apiRoute(method, pattern, handle, { prefix = false } = {}) {
  return { method, pattern, handle, prefix };
}

function matchApiRoute(route, request, url) {
  if (route.method !== request.method) return null;
  return matchApiPath(route, url.pathname);
}

function matchApiPath(route, pathname) {
  if (!route.prefix) return pathname === route.pattern ? { params: {} } : null;
  if (!pathname.startsWith(route.pattern) || pathname.length === route.pattern.length) return null;
  return { params: { rest: pathname.slice(route.pattern.length) } };
}

async function getMapApi(state, request, response) {
  sendJson(response, 200, await loadCodemap(state));
}

async function getMapVersionApi(state, request, response) {
  sendJson(response, 200, await loadMapVersion(state));
}

async function getTilesApi(state, request, response, url) {
  const codemap = await loadCodemap(state);
  const level = url.searchParams.get("level") ?? "file";
  const prefix = url.searchParams.get("prefix");
  sendJson(response, 200, prefix ? getTile(codemap, { level, prefix }) : buildTileIndex(codemap, level));
}

async function getPrefixesApi(state, request, response, url) {
  const codemap = await loadCodemap(state);
  const level = url.searchParams.get("level") ?? "file";
  sendJson(response, 200, { level, prefixes: visiblePrefixes(codemap, level) });
}

async function getResolveApi(state, request, response, url) {
  const codemap = await loadCodemap(state);
  const path = requiredParam(url, "path");
  const lineStart = optionalNumber(url.searchParams.get("lineStart"));
  const lineEnd = optionalNumber(url.searchParams.get("lineEnd"));
  const columnStart = optionalNumber(url.searchParams.get("columnStart"));
  const columnEnd = optionalNumber(url.searchParams.get("columnEnd"));
  sendJson(response, 200, resolveAddress(codemap, { path, lineStart, lineEnd, columnStart, columnEnd }));
}

async function getSourceApi(state, request, response, url) {
  const codemap = await loadCodemap(state);
  const path = requiredParam(url, "path");
  const file = codemap.files[normalizePathForMap(path)];
  if (!file) throw httpError(404, `No source file found for path: ${path}`);
  sendJson(response, 200, await readSourceRange(state.root, file, {
    lineStart: optionalNumber(url.searchParams.get("lineStart")) ?? 1,
    lineEnd: optionalNumber(url.searchParams.get("lineEnd")),
  }));
}

async function getNamedPlacesApi(state, request, response) {
  const codemap = await loadCodemap(state);
  sendJson(response, 200, withOverlaps(refreshNamedPlaces(codemap, await readJson(state.namedPlacesPath, { places: [] }))));
}

async function postNamedPlacesApi(state, request, response) {
  const codemap = await loadCodemap(state);
  const body = await readBody(request);
  const store = await readJson(state.namedPlacesPath, { places: [] });
  const place = createNamedPlace(codemap, body);
  store.places.push(place);
  await writeJson(state.namedPlacesPath, store);
  sendJson(response, 201, { place, overlaps: findNamedPlaceOverlaps(store.places) });
}

const NAMED_PLACE_CREATORS = new Map([
  ["drawnSelection", createNamedSelection],
  ["mapAddress", (_codemap, body) => createNamedAddress(body)],
]);

function createNamedPlace(codemap, body) {
  const kind = body.kind ?? "drawnSelection";
  const create = NAMED_PLACE_CREATORS.get(kind);
  if (!create) throw httpError(400, `Unknown named-place kind: ${kind}`);
  return create(codemap, body);
}

async function getAnnotationsApi(state, request, response) {
  const codemap = await loadCodemap(state);
  const store = refreshNamedPlaces(codemap, await readJson(state.namedPlacesPath, { places: [] }));
  sendJson(response, 200, { annotations: store.places.filter((place) => place.kind === "mapAnnotation") });
}

async function getAnnotationApi(state, request, response, url, match) {
  const codemap = await loadCodemap(state);
  const id = decodeURIComponent(match.params.rest);
  const store = refreshNamedPlaces(codemap, await readJson(state.namedPlacesPath, { places: [] }));
  const annotation = store.places.find((place) => place.kind === "mapAnnotation" && place.id === id);
  if (!annotation) throw httpError(404, `No annotation found for id: ${id}`);
  sendJson(response, 200, { annotation });
}

async function deleteAnnotationApi(state, request, response, url, match) {
  const id = decodeURIComponent(match.params.rest);
  const store = await readJson(state.namedPlacesPath, { places: [] });
  const index = store.places.findIndex((place) => place.kind === "mapAnnotation" && place.id === id);
  if (index === -1) throw httpError(404, `No annotation found for id: ${id}`);
  const [annotation] = store.places.splice(index, 1);
  await writeJson(state.namedPlacesPath, store);
  sendJson(response, 200, { deleted: true, annotation });
}

async function postAnnotationsApi(state, request, response) {
  const codemap = await loadCodemap(state);
  const body = await readBody(request);
  const store = await readJson(state.namedPlacesPath, { places: [] });
  const annotation = createMapAnnotation(codemap, body);
  store.places.push(annotation);
  await writeJson(state.namedPlacesPath, store);
  sendJson(response, 201, { annotation });
}

async function postSelectionResolveApi(state, request, response) {
  const codemap = await loadCodemap(state);
  const body = await readBody(request);
  sendJson(response, 200, createNamedSelection(codemap, { ...body, name: body.name ?? "Preview" }));
}

async function getActivityApi(state, request, response) {
  sendJson(response, 200, await activitySnapshot(state));
}

async function deleteActivityApi(state, request, response) {
  const before = await activitySnapshot(state);
  await state.activityStore.clear();
  sendJson(response, 200, { cleared: true, events: before.events.length });
}

async function postActivityApi(state, request, response) {
  acceptActivityRequest(state, request);
  sendJson(response, 202, { accepted: true });
}

async function serveStatic(state, response, pathname) {
  if (pathname.includes("..")) throw httpError(400, "Invalid path");
  const path = join(state.publicRoot, pathname);
  try {
    const content = await readFile(path);
    response.writeHead(200, { "content-type": MIME_TYPES[extname(path)] ?? "application/octet-stream" });
    response.end(content);
  } catch (error) {
    if (error.code === "ENOENT") throw httpError(404, "Not found");
    throw error;
  }
}

async function loadCodemap(state) {
  return JSON.parse(await readFile(state.mapPath, "utf8"));
}

async function loadMapVersion(state) {
  const stats = await stat(state.mapPath, { bigint: true });
  return {
    version: `${stats.mtimeNs.toString()}:${stats.size.toString()}`,
  };
}

function acceptActivityRequest(state, request) {
  readBody(request)
    .then(async (body) => {
      const address = body.address ?? resolveAddress(await loadCodemap(state), body);
      state.activityStore.add(createActivityEvent(address, body));
    })
    .catch((error) => {
      console.warn(`warning: activity-event-dropped error=${error.message}`);
    });
}

async function activitySnapshot(state) {
  const archived = await readActivityArchive(state.activityArchivePath);
  const live = state.activityStore.snapshot().events;
  return { events: mergeActivityEvents(archived, live) };
}

async function readActivityArchive(path) {
  let raw = "";
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const events = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event && typeof event === "object") events.push(event);
    } catch {
      // Ignore incomplete trailing writes or malformed external activity lines.
    }
  }
  return events;
}

function mergeActivityEvents(...groups) {
  const byId = new Map();
  for (const group of groups) {
    for (const event of group) {
      byId.set(event.id ?? `${event.timestamp}:${event.agentId}:${event.note}`, event);
    }
  }
  return [...byId.values()].sort((left, right) => {
    const byTime = String(left.timestamp ?? "").localeCompare(String(right.timestamp ?? ""));
    return byTime || String(left.id ?? "").localeCompare(String(right.id ?? ""));
  });
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value, null, 2));
}

function withOverlaps(store) {
  return {
    ...store,
    overlaps: findNamedPlaceOverlaps(store.places ?? []),
  };
}

function refreshNamedPlaces(codemap, store) {
  return {
    ...store,
    places: (store.places ?? []).map((place) => refreshPlaceResolution(codemap, place)),
  };
}

function requiredParam(url, name) {
  const value = url.searchParams.get(name);
  if (!value) throw httpError(400, `Missing query parameter: ${name}`);
  return value;
}

function optionalNumber(value) {
  return value === null ? undefined : Number(value);
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
