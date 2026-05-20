import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createActivityEvent } from "./activity.js";
import { createActivityStore } from "./activity-store.js";
import { findNamedPlaceOverlaps } from "./overlaps.js";
import { resolveAddress } from "./resolver.js";
import { createNamedAddress, createNamedSelection, resolveSelection } from "./selections.js";
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

export async function startServer({ root, mapPath, port, activityFlushIntervalMs, publicRoot = BUNDLED_PUBLIC_ROOT }) {
  const state = {
    root,
    mapPath,
    publicRoot,
    namedPlacesPath: join(root, ".scratch", "named-places.json"),
    activityStore: createActivityStore({
      archivePath: join(root, ".scratch", "activity-stream.jsonl"),
      flushIntervalMs: activityFlushIntervalMs,
    }),
  };

  const server = createServer((request, response) => {
    handleRequest(state, request, response).catch((error) => {
      sendJson(response, error.statusCode ?? 500, { error: error.message });
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  server.on("close", () => {
    state.activityStore.close().catch((error) => {
      console.warn(`Activity archive close flush skipped: ${error.message}`);
    });
  });

  console.log(`Codemap running at http://127.0.0.1:${port}`);
  return server;
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
  if (request.method === "GET" && url.pathname === "/api/map") {
    const codemap = await loadCodemap(state);
    sendJson(response, 200, codemap);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/map-version") {
    sendJson(response, 200, await loadMapVersion(state));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/tiles") {
    const codemap = await loadCodemap(state);
    const level = url.searchParams.get("level") ?? "file";
    const prefix = url.searchParams.get("prefix");
    sendJson(response, 200, prefix ? getTile(codemap, { level, prefix }) : buildTileIndex(codemap, level));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/prefixes") {
    const codemap = await loadCodemap(state);
    sendJson(response, 200, { level: url.searchParams.get("level") ?? "file", prefixes: visiblePrefixes(codemap, url.searchParams.get("level") ?? "file") });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/resolve") {
    const codemap = await loadCodemap(state);
    const path = requiredParam(url, "path");
    const lineStart = optionalNumber(url.searchParams.get("lineStart"));
    const lineEnd = optionalNumber(url.searchParams.get("lineEnd"));
    sendJson(response, 200, resolveAddress(codemap, { path, lineStart, lineEnd }));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/source") {
    const codemap = await loadCodemap(state);
    const path = requiredParam(url, "path");
    const file = codemap.files[path];
    if (!file) throw httpError(404, `No source file found for path: ${path}`);
    sendJson(response, 200, await readSourceRange(state.root, file, {
      lineStart: optionalNumber(url.searchParams.get("lineStart")) ?? 1,
      lineEnd: optionalNumber(url.searchParams.get("lineEnd")),
    }));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/named-places") {
    const codemap = await loadCodemap(state);
    sendJson(response, 200, withOverlaps(refreshNamedPlaces(codemap, await readJson(state.namedPlacesPath, { places: [] }))));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/named-places") {
    const codemap = await loadCodemap(state);
    const body = await readBody(request);
    const store = await readJson(state.namedPlacesPath, { places: [] });
    const place = body.kind === "mapAddress" ? createNamedAddress(body) : createNamedSelection(codemap, body);
    store.places.push(place);
    await writeJson(state.namedPlacesPath, store);
    sendJson(response, 201, { place, overlaps: findNamedPlaceOverlaps(store.places) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/selections/resolve") {
    const codemap = await loadCodemap(state);
    const body = await readBody(request);
    sendJson(response, 200, createNamedSelection(codemap, { ...body, name: body.name ?? "Preview" }));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/activity") {
    sendJson(response, 200, state.activityStore.snapshot());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/activity") {
    acceptActivityRequest(state, request);
    sendJson(response, 202, { accepted: true });
    return;
  }

  throw httpError(404, "Not found");
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
      const codemap = await loadCodemap(state);
      const address = body.address ?? resolveAddress(codemap, body);
      state.activityStore.add(createActivityEvent(address, body));
    })
    .catch((error) => {
      console.warn(`Dropped activity event: ${error.message}`);
    });
}

async function readBody(request) {
  let raw = "";
  for await (const chunk of request) raw += chunk;
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
    places: (store.places ?? []).map((place) => {
      if (place.kind !== "drawnSelection") return place;
      return {
        ...place,
        ...resolveSelection(codemap, {
          level: place.level,
          geometry: place.geometry,
        }),
      };
    }),
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
