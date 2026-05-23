/**
 * Activity event model + state normalization (**BR-044**).
 *
 * Four canonical states; `blocked` aliases to `reviewing`, unknown → `reading`.
 * The legacy `ActivityStateNormalizer`/`ActivityEventBuilder` classes were
 * test-only scaffolding and are dropped; `createActivityEvent` is the entry point.
 */

import { randomUUID } from "node:crypto";
import type { ResolvedAddress, ResolvedAddressFragment } from "./resolver.ts";

const ACTIVITY_STATES = ["reading", "editing", "testing", "reviewing"] as const;
const ACTIVITY_STATE_SET: ReadonlySet<string> = new Set(ACTIVITY_STATES);
const OPTIONAL_ACTIVITY_EVENT_FIELDS = ["hookEventName", "sessionId", "threadId", "threadUri", "turnId", "model"] as const;

export type ActivityState = typeof ACTIVITY_STATES[number];
export type ActivityStateInput = string | undefined;
export type ActivityAddressFragment = Partial<ResolvedAddressFragment> & {
  [key: string]: unknown;
};
export type ActivityAddress = Partial<Pick<
  ResolvedAddress,
  | "level"
  | "targetType"
  | "path"
  | "geohash"
  | "deepLink"
  | "breadcrumb"
  | "bounds"
  | "geo"
  | "lineRange"
  | "tokenRange"
  | "coveringSet"
>> & {
  fragments?: ActivityAddressFragment[];
  [key: string]: unknown;
};

export type ActivityEventInput = {
  id?: string;
  agentId?: string;
  activityState?: ActivityStateInput;
  state?: ActivityStateInput;
  timestamp?: string;
  note?: string;
  hookEventName?: string;
  sessionId?: string;
  threadId?: string;
  threadUri?: string;
  turnId?: string;
  model?: string;
};

export type ActivityEvent = {
  id: string;
  agentId: string;
  activityState: ActivityState;
  address: ActivityAddress;
  timestamp: string;
  note: string;
  hookEventName?: string;
  sessionId?: string;
  threadId?: string;
  threadUri?: string;
  turnId?: string;
  model?: string;
};

/** Build a normalized activity event, defaulting id/agent/timestamp/note. */
export function createActivityEvent(address: ActivityAddress, input: ActivityEventInput): ActivityEvent {
  const event: ActivityEvent = {
    id: input.id ?? randomUUID(),
    agentId: input.agentId ?? "agent",
    activityState: normalizeActivityState(input.activityState ?? input.state),
    address,
    timestamp: input.timestamp ?? new Date().toISOString(),
    note: input.note ?? "",
  };
  for (const key of OPTIONAL_ACTIVITY_EVENT_FIELDS) {
    const value = input[key];
    if (value) event[key] = value;
  }
  return event;
}

/** Normalize a raw state string (BR-044): `blocked`→`reviewing`, unknown→`reading`. */
export function normalizeActivityState(activityState: ActivityStateInput): ActivityState {
  if (activityState === "blocked") return "reviewing";
  if (isActivityState(activityState)) return activityState;
  return "reading";
}

function isActivityState(activityState: ActivityStateInput): activityState is ActivityState {
  return activityState !== undefined && ACTIVITY_STATE_SET.has(activityState);
}
