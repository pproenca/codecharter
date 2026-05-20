import { randomUUID } from "node:crypto";

export function createActivityEvent(address, input) {
  return {
    id: input.id ?? randomUUID(),
    agentId: input.agentId ?? "agent",
    activityState: input.activityState ?? input.state ?? "reading",
    address,
    timestamp: input.timestamp ?? new Date().toISOString(),
    note: input.note ?? "",
  };
}
