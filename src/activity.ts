import { randomUUID } from "node:crypto";

export type ActivityState = "reading" | "editing" | "testing" | "reviewing";

export type ActivityStateInput = ActivityState | "blocked" | string | undefined;

export type ActivityAddress = Record<string, unknown>;

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

type ActivityStateNormalizerLike = {
  normalize(activityState: ActivityStateInput): ActivityState;
};

const ACTIVE_ACTIVITY_STATES: ReadonlySet<string> = new Set(["reading", "editing", "testing", "reviewing"]);

export class ActivityStateNormalizer {
  normalize(activityState: ActivityStateInput): ActivityState {
    return normalizeActivityState(activityState);
  }
}

export class ActivityEventBuilder {
  private readonly normalizeActivityState: (activityState: ActivityStateInput) => ActivityState;

  constructor(stateNormalizer: ActivityStateNormalizerLike = { normalize: normalizeActivityState }) {
    this.normalizeActivityState = (activityState) => stateNormalizer.normalize(activityState);
  }

  create(address: ActivityAddress, input: ActivityEventInput): ActivityEvent {
    return activityEvent(address, input, this.normalizeActivityState);
  }
}

export function createActivityEvent(address: ActivityAddress, input: ActivityEventInput): ActivityEvent {
  return activityEvent(address, input, normalizeActivityState);
}

function normalizeActivityState(activityState: ActivityStateInput): ActivityState {
  if (activityState === "blocked") return "reviewing";
  if (activityState && ACTIVE_ACTIVITY_STATES.has(activityState)) return activityState as ActivityState;
  return "reading";
}

function activityEvent(
  address: ActivityAddress,
  input: ActivityEventInput,
  normalize: (activityState: ActivityStateInput) => ActivityState,
): ActivityEvent {
  return {
    id: input.id ?? randomUUID(),
    agentId: input.agentId ?? "agent",
    activityState: normalize(input.activityState ?? input.state),
    address,
    timestamp: input.timestamp ?? new Date().toISOString(),
    note: input.note ?? "",
    ...(input.hookEventName ? { hookEventName: input.hookEventName } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.threadId ? { threadId: input.threadId } : {}),
    ...(input.threadUri ? { threadUri: input.threadUri } : {}),
    ...(input.turnId ? { turnId: input.turnId } : {}),
    ...(input.model ? { model: input.model } : {}),
  };
}
