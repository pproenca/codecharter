/**
 * Shared type vocabulary for the localhost API: the server state handlers
 * operate on, the route/handler shapes, and the small response/cache types.
 * Extracted from the former `server.ts` god-file so handlers can live in their
 * own modules without re-declaring the contract.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { createActivityStore, StoredActivityEvent } from "../activity-store.ts";
import type { CodecharterCodemap } from "../resolver.ts";
import type { MapAnnotation, NamedAddress, NamedSelection } from "../selections.ts";

export type CodemapCache = {
  signature: string;
  codemap: CodecharterCodemap;
};

export type ViewerActivityArchiveCache = {
  size: bigint;
  recent: StoredActivityEvent[];
  explored: StoredActivityEvent[];
};

export type ServerState = {
  root: string;
  mapPath: string;
  publicRoot: string;
  namedPlacesPath: string;
  namedPlacesMutation: Promise<unknown>;
  activityArchivePath: string;
  activityStore: ReturnType<typeof createActivityStore>;
  codemapCache?: CodemapCache; // HARDENING/perf: mtime:size-keyed parsed-map cache
  viewerActivityArchiveCache?: ViewerActivityArchiveCache;
};

export type HttpError = Error & { statusCode: number };

export type NamedPlace = NamedSelection | MapAnnotation | NamedAddress;
export type NamedPlacesStore = { places: NamedPlace[] };
export type JsonObject = Record<string, unknown>;

export type ApiRouteParams = { rest?: string };
export type ApiRouteMatch = { params: ApiRouteParams };
export type MatchedApiRoute = ApiRouteMatch & { route: ApiRoute };
export type ApiHandler = (
  state: ServerState,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  match: ApiRouteMatch,
) => void | Promise<void>;
export type ApiRoute = {
  method: string;
  pattern: string;
  handle: ApiHandler;
  prefix: boolean;
};

export type ActivitySnapshot = {
  events: StoredActivityEvent[];
  version?: string;
  unchanged?: true;
};
export type ViewerActivityDetail = "summary" | "full";
