import { randomUUID } from "node:crypto";

const ACTIVE_ACTIVITY_STATES = new Set(["reading", "editing", "testing", "reviewing"]);

export class ActivityStateNormalizer {
  normalize(activityState) {
    if (activityState === "blocked") return "reviewing";
    if (ACTIVE_ACTIVITY_STATES.has(activityState)) return activityState;
    return "reading";
  }
}

export class ActivityEventBuilder {
  constructor(stateNormalizer = new ActivityStateNormalizer()) {
    this.stateNormalizer = stateNormalizer;
  }

  create(address, input) {
    return {
      id: input.id ?? randomUUID(),
      agentId: input.agentId ?? "agent",
      activityState: this.stateNormalizer.normalize(input.activityState ?? input.state),
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
}

const ACTIVITY_EVENT_BUILDER = new ActivityEventBuilder();

export function createActivityEvent(address, input) {
  return ACTIVITY_EVENT_BUILDER.create(address, input);
}
