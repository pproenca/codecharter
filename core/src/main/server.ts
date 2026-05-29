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

import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, isAbsolute, join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createActivityStore } from "./activity-store.ts";
import type { StoredActivityEvent, ViewerFogState } from "./activity-store.ts";
import { createActivityEvent } from "./activity.ts";
import type { ActivityAddress, ActivityEventInput } from "./activity.ts";
import { loadCodemap } from "./api/codemap-cache.ts";
import type {
  ActivitySnapshot,
  ApiHandler,
  ApiRoute,
  ApiRouteMatch,
  JsonObject,
  MatchedApiRoute,
  ServerState,
  ViewerActivityArchiveCache,
  ViewerActivityDetail,
} from "./api/context.ts";
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
import { httpError, readBody, sendJson } from "./api/http.ts";
import { stringFields } from "./api/parse.ts";
import { limitToRecent, objectRecord, sortIfNeeded } from "./collections.ts";
import { errorMessage, isErrnoException } from "./errors.ts";
import { ACTIVITY_ARCHIVE_FILE, CONFIG_FILE, NAMED_PLACES_FILE } from "./paths.ts";
import { normalizePathForMap, resolveAddress } from "./resolver.ts";
import type { AddressRequest } from "./resolver.ts";
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
// Activity newer than this window renders as a "live"/visible trail; older
// activity falls back to "explored" discovery fog. 360 min = 6 hours.
// NOTE (brief OQ-1): whether 6h is the intended horizon vs ADR-0005 is an open
// question; this only documents the current value, it does not change it.
const VIEWER_ACTIVITY_LIVE_WINDOW_MS = 360 * 60 * 1000;
// Max number of recent events kept per viewer activity trail before trimming.
const VIEWER_ACTIVITY_TRAIL_LIMIT = 80;
// HARDENING (CWE-400): cap events retained when reading the append-ordered
// activity archive into memory, so a pathologically large log cannot exhaust
// it. The newest events are what every caller renders.
const ACTIVITY_ARCHIVE_READ_LIMIT = 50_000;

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
const VIEWER_SUMMARY_ADDRESS_STRING_FIELDS = [
  "path",
  "deepLink",
  "geohash",
] as const satisfies readonly (keyof ActivityAddress & string)[];
const VIEWER_SUMMARY_ADDRESS_RANGE_FIELDS = [
  "lineRange",
  "tokenRange",
] as const satisfies readonly (keyof ActivityAddress & string)[];
const VIEWER_SUMMARY_EVENT_FIELDS = [
  "id",
  "agentId",
  "activityState",
  "state",
  "timestamp",
  "note",
  "threadId",
  "sessionId",
] as const satisfies readonly (keyof ActivityEventInput & string)[];

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

async function getActivityApi(
  state: ServerState,
  _request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  sendJson(
    response,
    200,
    await activitySnapshot(state, {
      viewer: url.searchParams.get("view") === "viewer",
      detail: url.searchParams.get("detail") === "summary" ? "summary" : "full",
      ...(url.searchParams.has("version")
        ? { version: url.searchParams.get("version") ?? "" }
        : {}),
    }),
  );
}

async function deleteActivityApi(
  state: ServerState,
  _request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const before = await activitySnapshot(state);
  await state.activityStore.clear();
  sendJson(response, 200, { cleared: true, events: before.events.length });
}

async function postActivityApi(
  state: ServerState,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  acceptActivityRequest(state, request);
  sendJson(response, 202, { accepted: true });
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

// HARDENING: validate + cache the codemap (BR-037, Q4) keyed by the mtime:size
// signature already used for /api/map-version. A corrupt/foreign map is rejected
// with a clear, actionable error instead of an opaque downstream TypeError.
function acceptActivityRequest(state: ServerState, request: IncomingMessage): void {
  readBody(request)
    .then(async (body) => {
      const activityBody = activityEventInputFromBody(body);
      const address =
        activityAddressFromBody(body) ??
        resolveAddress(await loadCodemap(state), addressRequestFromBody(body));
      state.activityStore.add(createActivityEvent(address, activityBody));
    })
    .catch((error) => {
      console.warn(`warning: activity-event-dropped error=${errorMessage(error)}`);
    });
}

async function activitySnapshot(
  state: ServerState,
  {
    viewer = false,
    version,
    detail = "full",
  }: { viewer?: boolean; version?: string; detail?: ViewerActivityDetail } = {},
): Promise<ActivitySnapshot> {
  if (viewer) {
    return viewerActivitySnapshot(state, version, detail);
  }
  const archived = await readActivityArchive(state.activityArchivePath);
  const live = state.activityStore.snapshot().events;
  return { events: mergeActivityEvents(archived, live) };
}

async function viewerActivitySnapshot(
  state: ServerState,
  requestedVersion: string | undefined,
  detail: ViewerActivityDetail,
): Promise<ActivitySnapshot> {
  const now = Date.now();
  const archiveStats = await fileStats(state.activityArchivePath);
  const live = state.activityStore.snapshot().events;
  const version = viewerActivityVersion(archiveStats?.size ?? 0n, live, now, detail);
  if (requestedVersion && requestedVersion === version) {
    return { events: [], version, unchanged: true };
  }
  const archived = await readViewerActivityArchive(state, now);
  return {
    events: compactViewerActivityEvents(
      [...archived.explored, ...archived.recent, ...live],
      now,
      detail,
    ),
    version,
  };
}

function viewerActivityVersion(
  archiveSize: bigint,
  live: StoredActivityEvent[],
  now: number,
  detail: ViewerActivityDetail,
): string {
  const latest = live.at(-1);
  return [
    detail,
    archiveSize.toString(),
    live.length,
    latest?.id ?? "",
    latest?.timestamp ?? "",
    Math.floor(now / 60000),
  ].join(":");
}

async function readViewerActivityArchive(
  state: ServerState,
  now: number,
): Promise<ViewerActivityArchiveCache> {
  const stats = await fileStats(state.activityArchivePath);
  if (!stats) {
    delete state.viewerActivityArchiveCache;
    return { size: 0n, recent: [], explored: [] };
  }

  const previous = state.viewerActivityArchiveCache;
  if (previous && stats.size === previous.size) {
    return previous;
  }

  const appendOnly = previous && stats.size > previous.size;
  const recent = appendOnly ? previous.recent : [];
  const exploredByPath = new Map<string, StoredActivityEvent>();
  if (appendOnly) {
    for (const event of previous.explored) {
      const path = activityEventPath(event);
      if (path && !exploredByPath.has(path)) {
        exploredByPath.set(path, event);
      }
    }
  }

  const start = appendOnly ? Number(previous.size) : 0;
  let stream;
  try {
    stream = createReadStream(state.activityArchivePath, { encoding: "utf8", start });
    const reader = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of reader) {
      if (!line.trim()) {
        continue;
      }
      try {
        const event = objectRecord(JSON.parse(line));
        if (!event) {
          continue;
        }
        const path = activityEventPath(event);
        if (path && !exploredByPath.has(path)) {
          exploredByPath.set(path, event);
        }
        if (isViewerLiveActivityEvent(event, now)) {
          recent.push(event);
        }
      } catch {
        // Ignore incomplete trailing writes or malformed external activity lines.
      }
    }
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return { size: 0n, recent: [], explored: [] };
    }
    throw error;
  } finally {
    stream?.destroy();
  }

  state.viewerActivityArchiveCache = {
    size: stats.size,
    recent,
    explored: [...exploredByPath.values()],
  };
  return state.viewerActivityArchiveCache;
}

async function fileStats(path: string): Promise<{ size: bigint } | null> {
  try {
    const stats = await stat(path, { bigint: true });
    return { size: stats.size };
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function compactViewerActivityEvents(
  events: StoredActivityEvent[],
  now: number,
  detail: ViewerActivityDetail,
): StoredActivityEvent[] {
  const selectedIds = new Set<string>();
  const selected: StoredActivityEvent[] = [];
  const liveTail: StoredActivityEvent[] = [];
  const latestByActor = new Map<string, StoredActivityEvent>();
  const liveByPath = new Map<string, StoredActivityEvent>();
  const exploredByPath = new Map<string, StoredActivityEvent>();

  for (const event of events) {
    const path = activityEventPath(event);
    if (path && !exploredByPath.has(path)) {
      exploredByPath.set(path, event);
    }
    if (!isViewerLiveActivityEvent(event, now)) {
      continue;
    }

    liveTail.push(event);
    if (liveTail.length > VIEWER_ACTIVITY_TRAIL_LIMIT) {
      liveTail.shift();
    }
    const actor = activityActorKey(event);
    if (actor) {
      latestByActor.set(actor, latestActivityEvent(latestByActor.get(actor), event));
    }
    if (path) {
      liveByPath.set(path, latestActivityEvent(liveByPath.get(path), event));
    }
  }

  if (detail === "full") {
    for (const [path, event] of exploredByPath) {
      selectActivityEvent(viewerFogMarker(event, path, "explored"), selected, selectedIds);
    }
    for (const [path, event] of liveByPath) {
      selectActivityEvent(viewerFogMarker(event, path, "visible"), selected, selectedIds);
    }
  }
  for (const event of latestByActor.values()) {
    selectActivityEvent(
      detail === "summary" ? viewerSummaryEvent(event) : event,
      selected,
      selectedIds,
    );
  }
  if (detail === "summary") {
    return sortIfNeeded(selected, compareStoredActivityEventsByTime);
  }
  for (const event of liveTail) {
    selectActivityEvent(event, selected, selectedIds);
  }

  return sortIfNeeded(selected, compareStoredActivityEventsByTime);
}

function selectActivityEvent(
  event: StoredActivityEvent,
  selected: StoredActivityEvent[],
  selectedIds: Set<string>,
): void {
  const id = event.id ?? "";
  if (id) {
    if (selectedIds.has(id)) {
      return;
    }
    selectedIds.add(id);
  }
  selected.push(event);
}

function viewerFogMarker(
  event: StoredActivityEvent,
  path: string,
  fogState: ViewerFogState,
): StoredActivityEvent {
  return {
    id: `viewer-fog:${fogState}:${path}`,
    timestamp: event.timestamp ?? "",
    viewerFogState: fogState,
    address: { path },
    ...pickDefined(event, ["agentId", "activityState"] as const),
  };
}

function viewerSummaryEvent(event: StoredActivityEvent): StoredActivityEvent {
  const summary: StoredActivityEvent = pickDefined(event, VIEWER_SUMMARY_EVENT_FIELDS);
  const summaryAddress = viewerSummaryAddress(event.address);
  if (summaryAddress) {
    summary.address = summaryAddress;
  }
  return summary;
}

function viewerSummaryAddress(address: ActivityAddress | undefined): ActivityAddress | undefined {
  if (!address) {
    return undefined;
  }
  const summary: ActivityAddress = {
    ...pickDefined(address, VIEWER_SUMMARY_ADDRESS_STRING_FIELDS),
    ...pickDefined(address, VIEWER_SUMMARY_ADDRESS_RANGE_FIELDS),
  };
  return Object.keys(summary).length ? summary : undefined;
}

function pickDefined<T extends Record<PropertyKey, unknown>, const K extends readonly (keyof T)[]>(
  source: T,
  keys: K,
): Partial<Pick<T, K[number]>> {
  const picked: Partial<Pick<T, K[number]>> = {};
  for (const key of keys) {
    if (source[key] !== undefined) {
      picked[key] = source[key];
    }
  }
  return picked;
}

function latestActivityEvent(
  current: StoredActivityEvent | undefined,
  next: StoredActivityEvent,
): StoredActivityEvent {
  if (!current) {
    return next;
  }
  return compareStoredActivityEventsByTime(current, next) <= 0 ? next : current;
}

function compareStoredActivityEventsByTime(
  left: StoredActivityEvent,
  right: StoredActivityEvent,
): number {
  const leftTime = storedActivityTimestamp(left);
  const rightTime = storedActivityTimestamp(right);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  if (Number.isFinite(leftTime) !== Number.isFinite(rightTime)) {
    return Number.isFinite(leftTime) ? -1 : 1;
  }
  return String(left.id ?? "").localeCompare(String(right.id ?? ""));
}

function isViewerLiveActivityEvent(event: StoredActivityEvent, now: number): boolean {
  const timestamp = storedActivityTimestamp(event);
  if (!Number.isFinite(timestamp)) {
    return true;
  }
  return Math.max(0, now - timestamp) <= VIEWER_ACTIVITY_LIVE_WINDOW_MS;
}

function storedActivityTimestamp(event: StoredActivityEvent): number {
  return Date.parse(event.timestamp ?? "");
}

function activityActorKey(event: StoredActivityEvent): string {
  const thread = event.threadId ?? event.sessionId ?? "";
  const agent = event.agentId ?? "agent";
  return `${agent}:${thread}`;
}

function activityEventPath(event: StoredActivityEvent): string {
  const { address } = event;
  for (const candidate of [
    address?.path,
    event.path,
    pathFromActivityDeepLink(address?.deepLink),
  ]) {
    if (candidate) {
      return normalizePathForMap(candidate);
    }
  }
  return "";
}

function pathFromActivityDeepLink(deepLink: string | undefined): string {
  if (!deepLink) {
    return "";
  }
  try {
    return new URL(deepLink).searchParams.get("path") ?? "";
  } catch {
    return "";
  }
}

async function readActivityArchive(path: string): Promise<StoredActivityEvent[]> {
  let events: StoredActivityEvent[] = [];
  let stream;
  try {
    stream = createReadStream(path, { encoding: "utf8" });
    const reader = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of reader) {
      if (!line.trim()) {
        continue;
      }
      try {
        const event = objectRecord(JSON.parse(line));
        if (event) {
          events.push(event);
          // Keep memory bounded mid-stream: once we hold twice the cap, drop the
          // oldest back to the cap so a giant archive never fully materializes.
          if (events.length >= ACTIVITY_ARCHIVE_READ_LIMIT * 2) {
            events = limitToRecent(events, ACTIVITY_ARCHIVE_READ_LIMIT);
          }
        }
      } catch {
        // Ignore incomplete trailing writes or malformed external activity lines.
      }
    }
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  } finally {
    stream?.destroy();
  }
  return limitToRecent(events, ACTIVITY_ARCHIVE_READ_LIMIT);
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

function activityEventInputFromBody(body: JsonObject): ActivityEventInput {
  return stringFields(body, ACTIVITY_EVENT_STRING_FIELDS);
}

function activityAddressFromBody(body: JsonObject): ActivityAddress | undefined {
  return objectRecord(body.address) ?? undefined;
}

function addressRequestFromBody(body: JsonObject): AddressRequest {
  if (typeof body.path !== "string") {
    throw new Error("Activity path is required when address is not provided");
  }
  const request: AddressRequest = { path: body.path };
  for (const key of ADDRESS_RANGE_FIELDS) {
    if (typeof body[key] === "string" || typeof body[key] === "number") {
      request[key] = body[key];
    }
  }
  return request;
}
