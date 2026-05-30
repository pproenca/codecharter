/**
 * Activity-domain API handlers + the viewer snapshot/fog machinery.
 *
 * Activity telemetry is best-effort and kept separate from stable map geography:
 * malformed or unmapped events are dropped, never blocking code work. The viewer
 * snapshot derives "visible" vs "explored" discovery fog from a time window and
 * is version-keyed so unchanged polls return early.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createInterface } from "node:readline";
import type { StoredActivityEvent, ViewerFogState } from "../../activity-store.ts";
import { createActivityEvent } from "../../activity.ts";
import type { ActivityAddress, ActivityEventInput } from "../../activity.ts";
import { limitToRecent, objectRecord, sortIfNeeded } from "../../collections.ts";
import { errorMessage, isErrnoException } from "../../errors.ts";
import { normalizePathForMap, resolveAddress } from "../../resolver.ts";
import type { AddressRequest } from "../../resolver.ts";
import { loadCodemap } from "../codemap-cache.ts";
import type {
  ActivitySnapshot,
  JsonObject,
  ServerState,
  ViewerActivityArchiveCache,
  ViewerActivityDetail,
} from "../context.ts";
import { readBody, sendJson } from "../http.ts";
import { stringFields } from "../parse.ts";

// Activity newer than this window renders as a "live"/visible trail; older
// activity falls back to "explored" discovery fog (ADR-0005). 6 minutes keeps
// "visible" meaning recent: a touched file glows briefly, then decays as
// attention moves on. (OQ-1 settled 2026-05-30: the prior `360 * 60 * 1000`
// = 6h was a seconds->minutes unit slip that kept most of a day's activity
// permanently "visible", defeating the fog. "live/recent" wants minutes.)
const VIEWER_ACTIVITY_LIVE_WINDOW_MS = 6 * 60 * 1000;
// Max number of recent events kept per viewer activity trail before trimming.
const VIEWER_ACTIVITY_TRAIL_LIMIT = 80;
// HARDENING (CWE-400): cap events retained when reading the append-ordered
// activity archive into memory, so a pathologically large log cannot exhaust
// it. The newest events are what every caller renders.
const ACTIVITY_ARCHIVE_READ_LIMIT = 50_000;
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

export async function getActivityApi(
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

export async function deleteActivityApi(
  state: ServerState,
  _request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const before = await activitySnapshot(state);
  await state.activityStore.clear();
  sendJson(response, 200, { cleared: true, events: before.events.length });
}

export async function postActivityApi(
  state: ServerState,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  acceptActivityRequest(state, request);
  sendJson(response, 202, { accepted: true });
}

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
