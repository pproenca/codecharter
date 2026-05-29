/**
 * Localhost API hardening: the `Host` allowlist (anti DNS-rebinding) and the
 * cross-site / cross-origin / content-type guards on mutating requests. Each
 * control is marked `// HARDENING` so it is not silently lost in a refactor.
 */

import type { IncomingMessage } from "node:http";
import { httpError } from "./http.ts";

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// HARDENING (CWE-350/346): a rebound DNS name (attacker.com → 127.0.0.1) carries
// its own hostname in the Host header; only loopback names are allowed.
export function assertLocalHost(request: IncomingMessage): void {
  const host = request.headers.host;
  // HARDENING (CWE-350/346): fail CLOSED (OQ-4) — a request with no Host header
  // must NOT bypass the loopback allowlist. Browsers and the CLI always send
  // Host; an absent/empty one is anomalous and is rejected.
  if (!host) {
    throw httpError(403, "Forbidden host");
  }
  if (!LOCAL_HOSTNAMES.has(normalizeHostname(host))) {
    throw httpError(403, "Forbidden host");
  }
}

// Strip an optional port and lower-case so the allowlist matches both bracketed
// and bare loopback IPv6 forms. HARDENING (CWE-697): a naive `:\d+$` strip
// mangled a bare `::1` into `:`, over-rejecting a legitimate loopback host.
function normalizeHostname(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (trimmed.startsWith("[")) {
    // Bracketed IPv6, optionally with a port: "[::1]" or "[::1]:8080".
    const end = trimmed.indexOf("]");
    return end === -1 ? trimmed : trimmed.slice(1, end);
  }
  if (trimmed.indexOf(":") !== trimmed.lastIndexOf(":")) {
    // Bare IPv6 (multiple colons) carries no port suffix per RFC 3986.
    return trimmed;
  }
  return trimmed.replace(/:\d+$/, "");
}

export function assertSafeMutationRequest(request: IncomingMessage): void {
  if (!MUTATING_METHODS.has(request.method ?? "")) {
    return;
  }

  const fetchSite = String(request.headers["sec-fetch-site"] ?? "").toLowerCase();
  if (fetchSite === "cross-site") {
    throw httpError(403, "Cross-site API mutations are not allowed");
  }

  const origin = request.headers.origin;
  if (typeof origin === "string" && !isLoopbackOrigin(origin)) {
    throw httpError(403, "Cross-origin API mutations are not allowed");
  }

  if (request.method !== "DELETE" && !isJsonContentType(request.headers["content-type"])) {
    throw httpError(415, "API mutations require application/json");
  }
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const { hostname, protocol } = new URL(origin);
    return protocol === "http:" && LOCAL_HOSTNAMES.has(hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isJsonContentType(value: string | string[] | undefined): boolean {
  const contentType = Array.isArray(value) ? value[0] : value;
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}
