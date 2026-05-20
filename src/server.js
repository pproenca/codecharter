import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { createActivityEvent } from "./activity.js";
import { findNamedPlaceOverlaps } from "./overlaps.js";
import { resolveAddress } from "./resolver.js";
import { createNamedAddress, createNamedSelection } from "./selections.js";
import { readSourceRange } from "./source.js";
import { readJson, writeJson } from "./store.js";
import { buildTileIndex, getTile, visiblePrefixes } from "./tiles.js";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

export async function startServer({ root, mapPath, port }) {
  const state = {
    root,
    mapPath,
    publicRoot: join(root, "public"),
    namedPlacesPath: join(root, ".scratch", "named-places.json"),
    activityPath: join(root, ".scratch", "activity-stream.json"),
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
    sendJson(response, 200, withOverlaps(await readJson(state.namedPlacesPath, { places: [] })));
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
    sendJson(response, 200, await readJson(state.activityPath, { events: [] }));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/activity") {
    const codemap = await loadCodemap(state);
    const body = await readBody(request);
    const address = body.address ?? resolveAddress(codemap, body);
    const event = createActivityEvent(address, body);
    const stream = await readJson(state.activityPath, { events: [] });
    stream.events.push(event);
    await writeJson(state.activityPath, stream);
    sendJson(response, 201, event);
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
