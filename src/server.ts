import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createActivityEvent } from "./activity.ts";
import { createActivityStore } from "./activity-store.ts";
import { MAP_LEVELS } from "./levels.ts";
import { findNamedPlaceOverlaps } from "./overlaps.ts";
import { normalizePathForMap, resolveAddress } from "./resolver.ts";
import { createMapAnnotation, createNamedAddress, createNamedSelection, refreshPlaceResolution } from "./selections.ts";
import { readSourceRange } from "./source.ts";
import { readJson, writeJson } from "./store.ts";
import { buildTileIndex, getTile, visiblePrefixes } from "./tiles.ts";
import { errorMessage, isErrnoException, objectRecord, sortIfNeeded } from "./util.ts";
import type { ActivityAddress, ActivityEventInput } from "./activity.js";
import type { StoredActivityEvent } from "./activity-store.js";
import type { AddressRequest, CodecharterCodemap } from "./resolver.js";
import type { MapLevel } from "./levels.js";
import type { MapAnnotation, NamedAddress, NamedSelection, SelectionGeometry, SelectionInput } from "./selections.js";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const BUNDLED_PUBLIC_ROOT = fileURLToPath(new URL("../public", import.meta.url));
const DEFAULT_PORT_SEARCH_LIMIT = 20;
const DEFAULT_ACTIVITY_ARCHIVE = ".codecharter/activity.jsonl";

type ServerConfig = {
  activityPath?: string;
  agents?: {
    codex?: {
      activityPath?: string;
    };
  };
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

type ServerState = {
  root: string;
  mapPath: string;
  publicRoot: string;
  namedPlacesPath: string;
  namedPlacesMutation: Promise<unknown>;
  activityArchivePath: string;
  activityStore: ReturnType<typeof createActivityStore>;
};

type HttpError = Error & {
  statusCode: number;
};

type NamedPlace = NamedSelection | MapAnnotation | NamedAddress;
type NamedPlacesStore = {
  places: NamedPlace[];
};
type JsonObject = Record<string, unknown>;
type ApiRouteParams = {
  rest?: string;
};
type ApiRouteMatch = {
  params: ApiRouteParams;
};
type MatchedApiRoute = ApiRouteMatch & {
  route: ApiRoute;
};
type ApiHandler = (
  state: ServerState,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  match: ApiRouteMatch,
) => void | Promise<void>;
type ApiRoute = {
  method: string;
  pattern: string;
  handle: ApiHandler;
  prefix: boolean;
};
type ActivitySnapshot = {
  events: StoredActivityEvent[];
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
const SELECTION_STRING_FIELDS = ["id", "name", "comment"] as const;
const ACTIVITY_EVENT_STRING_FIELDS = [
  "id",
  "agentId",
  "activityState",
  "state",
  "timestamp",
  "note",
  "hookEventName",
  "sessionId",
  "threadId",
  "threadUri",
  "turnId",
  "model",
] as const satisfies readonly (keyof ActivityEventInput & string)[];
const ADDRESS_RANGE_FIELDS = ["lineStart", "lineEnd", "columnStart", "columnEnd"] as const;

export async function startServer({
  root,
  mapPath,
  port,
  activityArchivePath,
  activityFlushIntervalMs,
  publicRoot = BUNDLED_PUBLIC_ROOT,
  portSearchLimit = DEFAULT_PORT_SEARCH_LIMIT,
}: ServerOptions): Promise<Server> {
  const resolvedActivityArchivePath = activityArchivePath ?? await configuredActivityArchivePath(root);
  const state: ServerState = {
    root,
    mapPath,
    publicRoot,
    namedPlacesPath: join(root, ".codecharter", "named-places.json"),
    namedPlacesMutation: Promise.resolve(),
    activityArchivePath: resolvedActivityArchivePath,
    activityStore: createActivityStore({
      archivePath: resolvedActivityArchivePath,
      ...(activityFlushIntervalMs === undefined ? {} : { flushIntervalMs: activityFlushIntervalMs }),
    }),
  };

  const server = createServer((request, response) => {
    handleRequest(state, request, response).catch((error) => {
      const statusCode = error instanceof Error && "statusCode" in error ? Number(error.statusCode) : 500;
      sendJson(response, statusCode, { error: error instanceof Error ? error.message : String(error) });
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

async function configuredActivityArchivePath(root: string): Promise<string> {
  const config = serverConfigFromValue(await readJson(join(root, ".codecharter", "config.json"), {}));
  const configured = config.agents?.codex?.activityPath ?? config.activityPath ?? DEFAULT_ACTIVITY_ARCHIVE;
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
      if (!isErrnoException(error) || error.code !== "EADDRINUSE" || candidate === lastPort) throw error;
    }
  }

  throw new Error(`No available port found from ${port} to ${lastPort}`);
}

async function listenOnce(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
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
      resolve();
    });
  });
}

async function handleRequest(state: ServerState, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (url.pathname.startsWith("/api/")) {
    await handleApi(state, request, response, url);
    return;
  }

  await serveStatic(state, response, url.pathname === "/" ? "/index.html" : url.pathname);
}

async function handleApi(state: ServerState, request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  const match = matchingApiRoute(request, url);
  if (match) {
    await match.route.handle(state, request, response, url, match);
    return;
  }

  if (knownApiPath(url)) throw httpError(405, "Method not allowed");
  throw httpError(404, "Not found");
}

function matchingApiRoute(request: IncomingMessage, url: URL): MatchedApiRoute | null {
  for (const route of API_ROUTES) {
    const match = matchApiRoute(route, request, url);
    if (match) return { route, ...match };
  }
  return null;
}

function knownApiPath(url: URL): boolean {
  return API_ROUTES.some((route) => matchApiPath(route, url.pathname));
}

function apiRoute(method: string, pattern: string, handle: ApiHandler, { prefix = false }: { prefix?: boolean } = {}): ApiRoute {
  return { method, pattern, handle, prefix };
}

function matchApiRoute(route: ApiRoute, request: IncomingMessage, url: URL): ApiRouteMatch | null {
  if (route.method !== request.method) return null;
  return matchApiPath(route, url.pathname);
}

function matchApiPath(route: ApiRoute, pathname: string): ApiRouteMatch | null {
  if (!route.prefix) return pathname === route.pattern ? { params: {} } : null;
  if (!pathname.startsWith(route.pattern) || pathname.length === route.pattern.length) return null;
  return { params: { rest: pathname.slice(route.pattern.length) } };
}

async function getMapApi(state: ServerState, _request: IncomingMessage, response: ServerResponse): Promise<void> {
  sendJson(response, 200, await loadCodemap(state));
}

async function getMapVersionApi(state: ServerState, _request: IncomingMessage, response: ServerResponse): Promise<void> {
  sendJson(response, 200, await loadMapVersion(state));
}

async function getTilesApi(state: ServerState, _request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  const codemap = await loadCodemap(state);
  const level = mapLevelParam(url.searchParams.get("level") ?? "file");
  const prefix = url.searchParams.get("prefix");
  sendJson(response, 200, prefix ? getTile(codemap, { level, prefix }) : buildTileIndex(codemap, level));
}

async function getPrefixesApi(state: ServerState, _request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  const codemap = await loadCodemap(state);
  const level = mapLevelParam(url.searchParams.get("level") ?? "file");
  sendJson(response, 200, { level, prefixes: visiblePrefixes(codemap, level) });
}

async function getResolveApi(state: ServerState, _request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  const codemap = await loadCodemap(state);
  const path = requiredParam(url, "path");
  const lineStart = optionalNumber(url.searchParams.get("lineStart"));
  const lineEnd = optionalNumber(url.searchParams.get("lineEnd"));
  const columnStart = optionalNumber(url.searchParams.get("columnStart"));
  const columnEnd = optionalNumber(url.searchParams.get("columnEnd"));
  sendJson(response, 200, resolveAddress(codemap, {
    path,
    ...(lineStart === undefined ? {} : { lineStart }),
    ...(lineEnd === undefined ? {} : { lineEnd }),
    ...(columnStart === undefined ? {} : { columnStart }),
    ...(columnEnd === undefined ? {} : { columnEnd }),
  }));
}

async function getSourceApi(state: ServerState, _request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  const codemap = await loadCodemap(state);
  const path = requiredParam(url, "path");
  const file = codemap.files[normalizePathForMap(path)];
  if (!file) throw httpError(404, `No source file found for path: ${path}`);
  const lineEnd = optionalNumber(url.searchParams.get("lineEnd"));
  sendJson(response, 200, await readSourceRange(state.root, file, {
    lineStart: optionalNumber(url.searchParams.get("lineStart")) ?? 1,
    ...(lineEnd === undefined ? {} : { lineEnd }),
  }));
}

async function getNamedPlacesApi(state: ServerState, _request: IncomingMessage, response: ServerResponse): Promise<void> {
  const codemap = await loadCodemap(state);
  sendJson(response, 200, withOverlaps(refreshNamedPlaces(codemap, await readJson(state.namedPlacesPath, { places: [] }))));
}

async function postNamedPlacesApi(state: ServerState, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const codemap = await loadCodemap(state);
  const body = await readBody(request);
  const result = await mutateNamedPlaces(state, (store) => {
    const place = createNamedPlace(codemap, body);
    store.places.push(place);
    return { place, overlaps: findNamedPlaceOverlaps(store.places) };
  });
  sendJson(response, 201, result);
}

function createNamedPlace(codemap: CodecharterCodemap, body: JsonObject): NamedPlace {
  const kind = body.kind ?? "drawnSelection";
  if (kind === "drawnSelection") return createNamedSelection(codemap, selectionInputFromBody(body));
  if (kind === "mapAnnotation") return createMapAnnotation(codemap, selectionInputFromBody(body));
  if (kind === "mapAddress") return createNamedAddress(namedAddressInputFromBody(body));
  throw httpError(400, `Unknown named-place kind: ${String(kind)}`);
}

async function getAnnotationsApi(state: ServerState, _request: IncomingMessage, response: ServerResponse): Promise<void> {
  const codemap = await loadCodemap(state);
  const store = refreshNamedPlaces(codemap, await readJson(state.namedPlacesPath, { places: [] }));
  sendJson(response, 200, { annotations: mapAnnotations(store.places) });
}

async function getAnnotationApi(
  state: ServerState,
  _request: IncomingMessage,
  response: ServerResponse,
  _url: URL,
  match: ApiRouteMatch,
): Promise<void> {
  const codemap = await loadCodemap(state);
  const id = decodeURIComponent(requiredRestParam(match));
  const store = refreshNamedPlaces(codemap, await readJson(state.namedPlacesPath, { places: [] }));
  const annotation = store.places.find((place) => place.kind === "mapAnnotation" && place.id === id);
  if (!annotation) throw httpError(404, `No annotation found for id: ${id}`);
  sendJson(response, 200, { annotation });
}

async function deleteAnnotationApi(
  state: ServerState,
  _request: IncomingMessage,
  response: ServerResponse,
  _url: URL,
  match: ApiRouteMatch,
): Promise<void> {
  const id = decodeURIComponent(requiredRestParam(match));
  const result = await mutateNamedPlaces(state, (store) => {
    const index = store.places.findIndex((place) => place.kind === "mapAnnotation" && place.id === id);
    if (index === -1) throw httpError(404, `No annotation found for id: ${id}`);
    const [annotation] = store.places.splice(index, 1);
    return { deleted: true, annotation };
  });
  sendJson(response, 200, result);
}

async function putAnnotationApi(
  state: ServerState,
  request: IncomingMessage,
  response: ServerResponse,
  _url: URL,
  match: ApiRouteMatch,
): Promise<void> {
  const codemap = await loadCodemap(state);
  const id = decodeURIComponent(requiredRestParam(match));
  const body = await readBody(request);
  const result = await mutateNamedPlaces(state, (store) => {
    const index = store.places.findIndex((place) => place.kind === "mapAnnotation" && place.id === id);
    if (index === -1) throw httpError(404, `No annotation found for id: ${id}`);
    const previous = store.places[index];
    if (!previous) throw httpError(404, `No annotation found for id: ${id}`);
    const annotation = {
      ...createMapAnnotation(codemap, selectionInputFromBody(body, { id })),
      createdAt: previous.createdAt,
    };
    store.places[index] = annotation;
    return { annotation };
  });
  sendJson(response, 200, result);
}

async function postAnnotationsApi(state: ServerState, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const codemap = await loadCodemap(state);
  const body = await readBody(request);
  const result = await mutateNamedPlaces(state, (store) => {
    const annotation = createMapAnnotation(codemap, selectionInputFromBody(body));
    store.places.push(annotation);
    return { annotation };
  });
  sendJson(response, 201, result);
}

async function mutateNamedPlaces<T>(state: ServerState, mutate: (store: NamedPlacesStore) => T | Promise<T>): Promise<T> {
  const operation = state.namedPlacesMutation.then(async () => {
    const store = normalizeNamedPlacesStore(await readJson(state.namedPlacesPath, { places: [] }));
    const result = await mutate(store);
    await writeJson(state.namedPlacesPath, store);
    return result;
  });
  state.namedPlacesMutation = operation.catch(() => {});
  return operation;
}

async function postSelectionResolveApi(state: ServerState, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const codemap = await loadCodemap(state);
  const body = await readBody(request);
  sendJson(response, 200, createNamedSelection(codemap, selectionInputFromBody(body, { name: String(body.name ?? "Preview") })));
}

async function getActivityApi(state: ServerState, _request: IncomingMessage, response: ServerResponse): Promise<void> {
  sendJson(response, 200, await activitySnapshot(state));
}

async function deleteActivityApi(state: ServerState, _request: IncomingMessage, response: ServerResponse): Promise<void> {
  const before = await activitySnapshot(state);
  await state.activityStore.clear();
  sendJson(response, 200, { cleared: true, events: before.events.length });
}

async function postActivityApi(state: ServerState, request: IncomingMessage, response: ServerResponse): Promise<void> {
  acceptActivityRequest(state, request);
  sendJson(response, 202, { accepted: true });
}

async function serveStatic(state: ServerState, response: ServerResponse, pathname: string): Promise<void> {
  if (pathname.includes("..")) throw httpError(400, "Invalid path");
  const path = join(state.publicRoot, pathname);
  try {
    const content = await readFile(path);
    response.writeHead(200, { "content-type": MIME_TYPES[extname(path)] ?? "application/octet-stream" });
    response.end(content);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") throw httpError(404, "Not found");
    throw error;
  }
}

async function loadCodemap(state: ServerState): Promise<CodecharterCodemap> {
  return JSON.parse(await readFile(state.mapPath, "utf8"));
}

async function loadMapVersion(state: ServerState): Promise<{ version: string }> {
  const stats = await stat(state.mapPath, { bigint: true });
  return {
    version: `${stats.mtimeNs}:${stats.size}`,
  };
}

function acceptActivityRequest(state: ServerState, request: IncomingMessage): void {
  readBody(request)
    .then(async (body) => {
      const activityBody = activityEventInputFromBody(body);
      const address = activityAddressFromBody(body) ?? resolveAddress(await loadCodemap(state), addressRequestFromBody(body));
      state.activityStore.add(createActivityEvent(address, activityBody));
    })
    .catch((error) => {
      console.warn(`warning: activity-event-dropped error=${errorMessage(error)}`);
    });
}

async function activitySnapshot(state: ServerState): Promise<ActivitySnapshot> {
  const archived = await readActivityArchive(state.activityArchivePath);
  const live = state.activityStore.snapshot().events;
  return { events: mergeActivityEvents(archived, live) };
}

async function readActivityArchive(path: string): Promise<StoredActivityEvent[]> {
  const events: StoredActivityEvent[] = [];
  let stream;
  try {
    stream = createReadStream(path, { encoding: "utf8" });
    const reader = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of reader) {
      if (!line.trim()) continue;
      try {
        const event = objectRecord(JSON.parse(line));
        if (event) events.push(storedActivityEventFromRecord(event));
      } catch {
        // Ignore incomplete trailing writes or malformed external activity lines.
      }
    }
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return [];
    throw error;
  } finally {
    stream?.destroy();
  }
  return events;
}

function mergeActivityEvents(...groups: StoredActivityEvent[][]): StoredActivityEvent[] {
  const byId = new Map<string, StoredActivityEvent>();
  for (const group of groups) {
    for (const event of group) {
      byId.set(event.id ?? `${event.timestamp}:${event.agentId}:${event.note}`, event);
    }
  }
  const events = [...byId.values()];
  return sortIfNeeded(events, compareActivityEvents);
}

function compareActivityEvents(left: StoredActivityEvent, right: StoredActivityEvent): number {
  const byTime = String(left.timestamp ?? "").localeCompare(String(right.timestamp ?? ""));
  return byTime || String(left.id ?? "").localeCompare(String(right.id ?? ""));
}

async function readBody(request: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    if (!raw) return {};
    const value = objectRecord(JSON.parse(raw));
    if (value) return value;
    throw httpError(400, "JSON body must be an object");
  } catch (error) {
    if (error instanceof SyntaxError) throw httpError(400, "Invalid JSON body");
    throw error;
  }
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value, null, 2));
}

function withOverlaps(store: NamedPlacesStore): NamedPlacesStore & { overlaps: ReturnType<typeof findNamedPlaceOverlaps> } {
  return {
    ...store,
    overlaps: findNamedPlaceOverlaps(store.places ?? []),
  };
}

function refreshNamedPlaces(codemap: CodecharterCodemap, store: unknown): NamedPlacesStore {
  const normalizedStore = normalizeNamedPlacesStore(store);
  return {
    ...normalizedStore,
    places: refreshPlaces(codemap, normalizedStore.places),
  };
}

function mapAnnotations(places: NamedPlace[]): MapAnnotation[] {
  return places.filter((place): place is MapAnnotation => place.kind === "mapAnnotation");
}

function refreshPlaces(codemap: CodecharterCodemap, places: NamedPlace[]): NamedPlace[] {
  return places.map((place) => refreshPlaceResolution(codemap, place));
}

function requiredParam(url: URL, name: string): string {
  const value = url.searchParams.get(name);
  if (!value) throw httpError(400, `Missing query parameter: ${name}`);
  return value;
}

function requiredRestParam(match: ApiRouteMatch): string {
  if (!match.params.rest) throw httpError(404, "Not found");
  return match.params.rest;
}

function optionalNumber(value: string | null): number | undefined {
  return value === null ? undefined : Number(value);
}

function httpError(statusCode: number, message: string): HttpError {
  return Object.assign(new Error(message), { statusCode });
}

function serverPort(address: string | AddressInfo | null): number {
  if (!address || typeof address === "string") throw new Error("Server did not expose a TCP port");
  return address.port;
}

function normalizeNamedPlacesStore(store: unknown): NamedPlacesStore {
  const record = objectRecord(store);
  return { places: Array.isArray(record?.places) ? record.places.filter(isNamedPlace) : [] };
}

function mapLevelParam(value: string): MapLevel {
  if (isMapLevel(value)) return value;
  throw httpError(400, `Unknown map level: ${value}`);
}

function serverConfigFromValue(value: unknown): ServerConfig {
  const record = objectRecord(value);
  if (!record) return {};
  const codex = objectRecord(objectRecord(record.agents)?.codex);
  const config: ServerConfig = {};
  if (typeof record.activityPath === "string") config.activityPath = record.activityPath;
  if (codex) {
    const codexConfig: NonNullable<NonNullable<ServerConfig["agents"]>["codex"]> = {};
    if (typeof codex.activityPath === "string") codexConfig.activityPath = codex.activityPath;
    config.agents = { codex: codexConfig };
  }
  return config;
}

function selectionInputFromBody(body: JsonObject, overrides: Partial<Pick<SelectionInput, "id" | "name" | "comment" | "level">> = {}): SelectionInput {
  const input: SelectionInput = { geometry: selectionGeometryFromValue(body.geometry), ...stringFields(body, SELECTION_STRING_FIELDS) };
  if (typeof body.level === "string" && isMapLevel(body.level)) input.level = body.level;
  return { ...input, ...overrides };
}

function selectionGeometryFromValue(value: unknown): SelectionGeometry {
  const record = objectRecord(value);
  if (!record || record.type !== "rect") {
    throw new Error("Only rectangle drawn selections are supported in v1");
  }
  return {
    type: "rect",
    bounds: boundsFromValue(record.bounds),
  };
}

function boundsFromValue(value: unknown): SelectionGeometry["bounds"] {
  const record = objectRecord(value);
  if (!record) throw new Error("Selection bounds must be an object");
  return {
    x: numberFromValue(record.x),
    y: numberFromValue(record.y),
    width: numberFromValue(record.width),
    height: numberFromValue(record.height),
  };
}

function namedAddressInputFromBody(body: JsonObject): Parameters<typeof createNamedAddress>[0] {
  const address = objectRecord(body.address);
  if (!address) throw httpError(400, "Map address named places require an address object");
  return { address, ...stringFields(body, ["id", "name"] as const) };
}

function activityEventInputFromBody(body: JsonObject): ActivityEventInput {
  return stringFields(body, ACTIVITY_EVENT_STRING_FIELDS);
}

function activityAddressFromBody(body: JsonObject): ActivityAddress | undefined {
  return objectRecord(body.address) ?? undefined;
}

function addressRequestFromBody(body: JsonObject): AddressRequest {
  if (typeof body.path !== "string") throw new Error("Activity path is required when address is not provided");
  const request: AddressRequest = { path: body.path };
  for (const key of ADDRESS_RANGE_FIELDS) {
    if (typeof body[key] === "string" || typeof body[key] === "number") request[key] = body[key];
  }
  return request;
}

function storedActivityEventFromRecord(record: JsonObject): StoredActivityEvent {
  return { ...record };
}

function stringFields<T extends string>(body: JsonObject, fields: readonly T[]): Partial<Record<T, string>> {
  const result: Partial<Record<T, string>> = {};
  for (const key of fields) {
    if (typeof body[key] === "string") result[key] = body[key];
  }
  return result;
}

function isNamedPlace(value: unknown): value is NamedPlace {
  const record = objectRecord(value);
  return record?.kind === "drawnSelection" || record?.kind === "mapAnnotation" || record?.kind === "mapAddress";
}

function numberFromValue(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected finite number, received: ${String(value)}`);
  return number;
}

function isMapLevel(value: string): value is MapLevel {
  return Object.hasOwn(MAP_LEVELS, value);
}
