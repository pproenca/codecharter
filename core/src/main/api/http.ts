/**
 * Shared request/response plumbing for the localhost API: bounded body reading,
 * JSON responses, query-parameter parsing, and the `HttpError` constructor every
 * handler throws to set a status code. Pure helpers — no server state.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { objectRecord } from "../collections.ts";
import type { ApiRouteMatch, HttpError, JsonObject } from "./context.ts";

export const MAX_BODY_BYTES = 1024 * 1024; // HARDENING: cap request bodies at 1 MB (DoS)

export async function readBody(request: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw httpError(413, "Request body too large");
    } // HARDENING (DoS)
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    if (!raw) {
      return {};
    }
    const value = objectRecord(JSON.parse(raw));
    if (value) {
      return value;
    }
    throw httpError(400, "JSON body must be an object");
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw httpError(400, "Invalid JSON body");
    }
    throw error;
  }
}

export function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value, null, 2));
}

export function requiredParam(url: URL, name: string): string {
  const value = url.searchParams.get(name);
  if (!value) {
    throw httpError(400, `Missing query parameter: ${name}`);
  }
  return value;
}

export function requiredRestParam(match: ApiRouteMatch): string {
  if (!match.params.rest) {
    throw httpError(404, "Not found");
  }
  return match.params.rest;
}

export function optionalNumber(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) {
    throw httpError(400, `Query parameter must be an integer: ${value}`);
  }
  const number = Number(trimmed);
  if (!Number.isSafeInteger(number)) {
    throw httpError(400, `Query parameter must be a safe integer: ${value}`);
  }
  return number;
}

export function httpError(statusCode: number, message: string): HttpError {
  return Object.assign(new Error(message), { statusCode });
}
