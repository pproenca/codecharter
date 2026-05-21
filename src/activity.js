import { randomUUID } from "node:crypto";

const ACTIVE_ACTIVITY_STATES = new Set(["reading", "editing", "testing", "reviewing"]);

export function createActivityEvent(address, input) {
  return {
    id: input.id ?? randomUUID(),
    agentId: input.agentId ?? "agent",
    activityState: normalizeActivityState(input.activityState ?? input.state),
    address,
    timestamp: input.timestamp ?? new Date().toISOString(),
    note: input.note ?? "",
    ...(input.hookEventName ? { hookEventName: input.hookEventName } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.turnId ? { turnId: input.turnId } : {}),
    ...(input.model ? { model: input.model } : {}),
  };
}

function normalizeActivityState(activityState) {
  if (activityState === "blocked") return "reviewing";
  if (ACTIVE_ACTIVITY_STATES.has(activityState)) return activityState;
  return "reading";
}
