import { randomUUID } from "node:crypto";

const ACTIVE_ACTIVITY_STATES = new Set(["reading", "editing", "testing", "reviewing"]);

export class ActivityStateNormalizer {
  normalize(activityState) {
    return normalizeActivityState(activityState);
  }
}

export class ActivityEventBuilder {
  constructor(stateNormalizer = { normalize: normalizeActivityState }) {
    this.normalizeActivityState = (activityState) => stateNormalizer.normalize(activityState);
  }

  create(address, input) {
    return activityEvent(address, input, this.normalizeActivityState);
  }
}

export function createActivityEvent(address, input) {
  return activityEvent(address, input, normalizeActivityState);
}

function normalizeActivityState(activityState) {
  if (activityState === "blocked") return "reviewing";
  if (ACTIVE_ACTIVITY_STATES.has(activityState)) return activityState;
  return "reading";
}

function activityEvent(address, input, normalize) {
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
