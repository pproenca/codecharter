/**
 * Localhost API routing: the frozen `API_ROUTES` table (method + path → handler)
 * and the dispatch that matches a request, enforces the mutation guards, and
 * runs the handler. The route table is the cross-tool contract — its method,
 * path, and response shapes must stay stable.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ApiHandler,
  ApiRoute,
  ApiRouteMatch,
  MatchedApiRoute,
  ServerState,
} from "./context.ts";
import { deleteActivityApi, getActivityApi, postActivityApi } from "./handlers/activity.ts";
import {
  getMapApi,
  getMapVersionApi,
  getPrefixesApi,
  getResolveApi,
  getSourceApi,
  getTilesApi,
} from "./handlers/map.ts";
import {
  deleteAnnotationApi,
  getAnnotationApi,
  getAnnotationsApi,
  getNamedPlacesApi,
  postAnnotationsApi,
  postNamedPlacesApi,
  postSelectionResolveApi,
  putAnnotationApi,
} from "./handlers/named-places.ts";
import { assertSafeMutationRequest } from "./hardening.ts";
import { httpError } from "./http.ts";

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

export async function handleApi(
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
