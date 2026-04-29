import { apiRequest } from "@/api/client";
import type { AgentEvent } from "@/lib/types";

export interface AgentEventsResponse {
  events: AgentEvent[];
}

export function listAgentEvents(agentId: string): Promise<AgentEventsResponse> {
  return apiRequest<AgentEventsResponse>(`/events?agent_id=${encodeURIComponent(agentId)}`);
}

export function createEvent(
  data: Record<string, unknown>,
): Promise<{ ok: boolean; event: AgentEvent }> {
  return apiRequest<{ ok: boolean; event: AgentEvent }>("/events", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateEvent(
  id: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return apiRequest<Record<string, unknown>>(`/events/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function deleteEvent(id: string): Promise<Record<string, unknown>> {
  return apiRequest<Record<string, unknown>>(`/events/${id}`, { method: "DELETE" });
}
