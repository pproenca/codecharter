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

export class ActivityStateNormalizer {
  normalize(activityState: ActivityStateInput): ActivityState { return normalizeActivityState(activityState); }
}

export class ActivityEventBuilder {
  private readonly stateNormalizer: { normalize(activityState: ActivityStateInput): ActivityState };

  constructor(stateNormalizer: { normalize(activityState: ActivityStateInput): ActivityState } = { normalize: normalizeActivityState }) {
    this.stateNormalizer = stateNormalizer;
  }

  create(address: ActivityAddress, input: ActivityEventInput): ActivityEvent {
    return activityEvent(address, input, (activityState) => this.stateNormalizer.normalize(activityState));
  }
}

export function createActivityEvent(address: ActivityAddress, input: ActivityEventInput): ActivityEvent {
  return activityEvent(address, input, normalizeActivityState);
}

function normalizeActivityState(activityState: ActivityStateInput): ActivityState {
  if (activityState === "blocked") return "reviewing";
  if (isActivityState(activityState)) return activityState;
  return "reading";
}

function isActivityState(activityState: ActivityStateInput): activityState is ActivityState {
  return activityState === "reading"
    || activityState === "editing"
    || activityState === "testing"
    || activityState === "reviewing";
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
