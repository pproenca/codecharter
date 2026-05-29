/**
 * Named-places API handlers: drawn selections, map annotations, and map
 * addresses — plus the annotation CRUD endpoints and the preview
 * selection-resolve. Writes are serialized through `mutateNamedPlaces` so
 * concurrent requests cannot interleave a read-modify-write on the store file.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { objectRecord } from "../../collections.ts";
import { findNamedPlaceOverlaps } from "../../overlaps.ts";
import type { CodecharterCodemap } from "../../resolver.ts";
import {
  createMapAnnotation,
  createNamedAddress,
  createNamedSelection,
  refreshPlaceResolution,
} from "../../selections.ts";
import type { MapAnnotation, SelectionGeometry, SelectionInput } from "../../selections.ts";
import { readJson, writeJson } from "../../store.ts";
import { loadCodemap } from "../codemap-cache.ts";
import type {
  ApiRouteMatch,
  JsonObject,
  NamedPlace,
  NamedPlacesStore,
  ServerState,
} from "../context.ts";
import { httpError, readBody, requiredRestParam, sendJson } from "../http.ts";
import { isMapLevel, numberFromValue, stringFields } from "../parse.ts";

const SELECTION_STRING_FIELDS = ["id", "name", "comment"] as const;

export async function getNamedPlacesApi(
  state: ServerState,
  _request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const codemap = await loadCodemap(state);
  const store = refreshNamedPlaces(codemap, await readJson(state.namedPlacesPath, { places: [] }));
  sendJson(response, 200, { ...store, overlaps: findNamedPlaceOverlaps(store.places ?? []) });
}

export async function postNamedPlacesApi(
  state: ServerState,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
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
  if (kind === "drawnSelection") {
    return createNamedSelection(codemap, selectionInputFromBody(body));
  }
  if (kind === "mapAnnotation") {
    return createMapAnnotation(codemap, selectionInputFromBody(body));
  }
  if (kind === "mapAddress") {
    return createNamedAddress(namedAddressInputFromBody(body));
  }
  throw httpError(400, `Unknown named-place kind: ${String(kind)}`);
}

export async function getAnnotationsApi(
  state: ServerState,
  _request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const codemap = await loadCodemap(state);
  const store = refreshNamedPlaces(codemap, await readJson(state.namedPlacesPath, { places: [] }));
  sendJson(response, 200, {
    annotations: store.places.filter(
      (place): place is MapAnnotation => place.kind === "mapAnnotation",
    ),
  });
}

export async function getAnnotationApi(
  state: ServerState,
  _request: IncomingMessage,
  response: ServerResponse,
  _url: URL,
  match: ApiRouteMatch,
): Promise<void> {
  const codemap = await loadCodemap(state);
  const id = decodeURIComponent(requiredRestParam(match));
  const store = refreshNamedPlaces(codemap, await readJson(state.namedPlacesPath, { places: [] }));
  const annotation = store.places.find(
    (place) => place.kind === "mapAnnotation" && place.id === id,
  );
  if (!annotation) {
    throw httpError(404, `No annotation found for id: ${id}`);
  }
  sendJson(response, 200, { annotation });
}

export async function deleteAnnotationApi(
  state: ServerState,
  _request: IncomingMessage,
  response: ServerResponse,
  _url: URL,
  match: ApiRouteMatch,
): Promise<void> {
  const id = decodeURIComponent(requiredRestParam(match));
  const result = await mutateNamedPlaces(state, (store) => {
    const index = store.places.findIndex(
      (place) => place.kind === "mapAnnotation" && place.id === id,
    );
    if (index === -1) {
      throw httpError(404, `No annotation found for id: ${id}`);
    }
    const [annotation] = store.places.splice(index, 1);
    return { deleted: true, annotation };
  });
  sendJson(response, 200, result);
}

export async function putAnnotationApi(
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
    const index = store.places.findIndex(
      (place) => place.kind === "mapAnnotation" && place.id === id,
    );
    if (index === -1) {
      throw httpError(404, `No annotation found for id: ${id}`);
    }
    const previous = store.places[index];
    if (!previous) {
      throw httpError(404, `No annotation found for id: ${id}`);
    }
    const annotation = {
      ...createMapAnnotation(codemap, selectionInputFromBody(body, { id })),
      createdAt: previous.createdAt,
    };
    store.places[index] = annotation;
    return { annotation };
  });
  sendJson(response, 200, result);
}

export async function postAnnotationsApi(
  state: ServerState,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const codemap = await loadCodemap(state);
  const body = await readBody(request);
  const result = await mutateNamedPlaces(state, (store) => {
    const annotation = createMapAnnotation(codemap, selectionInputFromBody(body));
    store.places.push(annotation);
    return { annotation };
  });
  sendJson(response, 201, result);
}

async function mutateNamedPlaces<T>(
  state: ServerState,
  mutate: (store: NamedPlacesStore) => T | Promise<T>,
): Promise<T> {
  const operation = state.namedPlacesMutation.then(async () => {
    const store = normalizeNamedPlacesStore(await readJson(state.namedPlacesPath, { places: [] }));
    const result = await mutate(store);
    await writeJson(state.namedPlacesPath, store);
    return result;
  });
  state.namedPlacesMutation = operation.catch(() => {});
  return operation;
}

export async function postSelectionResolveApi(
  state: ServerState,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const codemap = await loadCodemap(state);
  const body = await readBody(request);
  sendJson(
    response,
    200,
    createNamedSelection(
      codemap,
      selectionInputFromBody(body, { name: String(body.name ?? "Preview") }),
    ),
  );
}

export function refreshNamedPlaces(codemap: CodecharterCodemap, store: unknown): NamedPlacesStore {
  const normalizedStore = normalizeNamedPlacesStore(store);
  return {
    ...normalizedStore,
    places: normalizedStore.places.map((place) => refreshPlaceResolution(codemap, place)),
  };
}

function normalizeNamedPlacesStore(store: unknown): NamedPlacesStore {
  const record = objectRecord(store);
  return { places: Array.isArray(record?.places) ? record.places.filter(isNamedPlace) : [] };
}

function selectionInputFromBody(
  body: JsonObject,
  overrides: Partial<Pick<SelectionInput, "id" | "name" | "comment" | "level">> = {},
): SelectionInput {
  const input: SelectionInput = {
    geometry: selectionGeometryFromValue(body.geometry),
    ...stringFields(body, SELECTION_STRING_FIELDS),
  };
  if (typeof body.level === "string" && isMapLevel(body.level)) {
    input.level = body.level;
  }
  return { ...input, ...overrides };
}

function selectionGeometryFromValue(value: unknown): SelectionGeometry {
  const record = objectRecord(value);
  if (!record || record.type !== "rect") {
    throw new Error("Only rectangle drawn selections are supported in v1");
  }
  return { type: "rect", bounds: boundsFromValue(record.bounds) };
}

function boundsFromValue(value: unknown): SelectionGeometry["bounds"] {
  const record = objectRecord(value);
  if (!record) {
    throw new Error("Selection bounds must be an object");
  }
  return {
    x: numberFromValue(record.x),
    y: numberFromValue(record.y),
    width: numberFromValue(record.width),
    height: numberFromValue(record.height),
  };
}

function namedAddressInputFromBody(body: JsonObject): Parameters<typeof createNamedAddress>[0] {
  const address = objectRecord(body.address);
  if (!address) {
    throw httpError(400, "Map address named places require an address object");
  }
  return { address, ...stringFields(body, ["id", "name"] as const) };
}

function isNamedPlace(value: unknown): value is NamedPlace {
  const record = objectRecord(value);
  return (
    record?.kind === "drawnSelection" ||
    record?.kind === "mapAnnotation" ||
    record?.kind === "mapAddress"
  );
}
