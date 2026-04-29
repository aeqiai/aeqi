import { apiRequest } from "@/api/client";
import type { Idea, ScopeValue } from "@/lib/types";

export interface IdeasResponse {
  ideas: Idea[];
}

export interface StoreIdeaRequest {
  name: string;
  content: string;
  tags?: string[];
  agent_id?: string;
  scope?: ScopeValue;
  links?: string[];
}

export function listIdeas(params?: {
  root?: string;
  query?: string;
  limit?: number;
  agent_id?: string;
}): Promise<IdeasResponse> {
  const q = new URLSearchParams();
  if (params?.root) q.set("root", params.root);
  if (params?.query) q.set("query", params.query);
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.agent_id) q.set("agent_id", params.agent_id);
  const qs = q.toString();
  return apiRequest<IdeasResponse>(`/ideas${qs ? `?${qs}` : ""}`);
}

export function storeIdea(data: StoreIdeaRequest): Promise<{ ok: boolean; id: string }> {
  return apiRequest<{ ok: boolean; id: string }>("/ideas", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateIdea(
  id: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return apiRequest<Record<string, unknown>>(`/ideas/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function deleteIdea(
  id: string,
): Promise<{ ok: boolean; error?: string; quest_ids?: string[] }> {
  return apiRequest<{ ok: boolean; error?: string; quest_ids?: string[] }>(
    `/ideas/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}
