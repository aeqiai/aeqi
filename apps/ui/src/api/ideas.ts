import { apiRequest } from "@/api/client";
import type { Idea, IdeaEdges, ScopeValue } from "@/lib/types";

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
  // Tables-in-Ideas Phase 2.
  parent_idea_id?: string | null;
  properties?: Record<string, unknown> | null;
  kind?: string;
}

export interface UploadedIdeaFile {
  id: string;
  agent_id: string;
  name: string;
  mime: string;
  size_bytes: number;
  uploaded_by?: string | null;
  uploaded_at: string;
}

export interface UploadIdeaFileResponse {
  ok: boolean;
  file: UploadedIdeaFile;
  idea_id?: string;
  error?: string;
}

export function listIdeas(
  params?: {
    root?: string;
    query?: string;
    limit?: number;
    agent_id?: string;
  },
  scopedEntity?: string | null,
): Promise<IdeasResponse> {
  const q = new URLSearchParams();
  if (params?.root) q.set("root", params.root);
  if (params?.query) q.set("query", params.query);
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.agent_id) q.set("agent_id", params.agent_id);
  const qs = q.toString();
  return apiRequest<IdeasResponse>(`/ideas${qs ? `?${qs}` : ""}`, { scopedEntity });
}

export function storeIdea(
  data: StoreIdeaRequest,
  scopedEntity?: string | null,
): Promise<{ ok: boolean; id: string }> {
  return apiRequest<{ ok: boolean; id: string }>("/ideas", {
    method: "POST",
    body: JSON.stringify(data),
    scopedEntity,
  });
}

export function uploadFileToIdea(
  options: {
    agentId: string;
    file: File;
    parentIdeaId?: string | null;
    scope?: ScopeValue;
  },
  scopedEntity?: string | null,
): Promise<UploadIdeaFileResponse> {
  const form = new FormData();
  form.append("agent_id", options.agentId);
  if (options.scope) form.append("scope", options.scope);
  form.append("file", options.file, options.file.name || "file");
  const path = options.parentIdeaId
    ? `/ideas/${encodeURIComponent(options.parentIdeaId)}/files`
    : "/ideas/files";
  return apiRequest<UploadIdeaFileResponse>(path, {
    method: "POST",
    body: form,
    scopedEntity,
  });
}

export function updateIdea(
  id: string,
  body: Record<string, unknown>,
  scopedEntity?: string | null,
): Promise<Record<string, unknown>> {
  return apiRequest<Record<string, unknown>>(`/ideas/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
    scopedEntity,
  });
}

export function deleteIdea(
  id: string,
  scopedEntity?: string | null,
): Promise<{ ok: boolean; error?: string; quest_ids?: string[] }> {
  return apiRequest<{ ok: boolean; error?: string; quest_ids?: string[] }>(
    `/ideas/${encodeURIComponent(id)}`,
    { method: "DELETE", scopedEntity },
  );
}

export function getIdeaGraph(
  params?: {
    agent_id?: string;
    limit?: number;
  },
  scopedEntity?: string | null,
): Promise<Record<string, unknown>> {
  const q = new URLSearchParams();
  if (params?.agent_id) q.set("agent_id", params.agent_id);
  if (params?.limit) q.set("limit", String(params.limit));
  const qs = q.toString();
  return apiRequest<Record<string, unknown>>(`/ideas/graph${qs ? `?${qs}` : ""}`, {
    scopedEntity,
  });
}

export function getIdeaProfile(
  params?: { root?: string },
  scopedEntity?: string | null,
): Promise<Record<string, unknown>> {
  const q = new URLSearchParams();
  if (params?.root) q.set("root", params.root);
  const qs = q.toString();
  return apiRequest<Record<string, unknown>>(`/ideas/profile${qs ? `?${qs}` : ""}`, {
    scopedEntity,
  });
}

// Tables-in-Ideas Phase 2.

/** Direct children of an Idea, newest first. */
export function listIdeaChildren(id: string, scopedEntity?: string | null): Promise<IdeasResponse> {
  return apiRequest<IdeasResponse>(`/ideas/${encodeURIComponent(id)}/children`, {
    scopedEntity,
  });
}

/**
 * Deep-merge a JSON patch into an Idea's `properties` column.
 * Keys set in `patch` overwrite; keys absent are preserved; explicit
 * `null` removes a key.
 */
export function setIdeaProperties(
  id: string,
  properties: Record<string, unknown>,
  scopedEntity?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  return apiRequest<{ ok: boolean; error?: string }>(
    `/ideas/${encodeURIComponent(id)}/properties`,
    {
      method: "PUT",
      body: JSON.stringify(properties),
      scopedEntity,
    },
  );
}

// Idea graph edges.

/** Edges + backlinks for a single idea (outgoing links, incoming refs). */
export function getIdeaEdges(id: string, scopedEntity?: string | null): Promise<IdeaEdges> {
  return apiRequest<IdeaEdges>(`/ideas/${encodeURIComponent(id)}/edges`, { scopedEntity });
}

/** Create a typed edge from one idea to another. */
export function addIdeaEdge(
  sourceId: string,
  targetId: string,
  relation: string = "adjacent",
  scopedEntity?: string | null,
): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>(`/ideas/${encodeURIComponent(sourceId)}/edges`, {
    method: "POST",
    body: JSON.stringify({ target_id: targetId, relation }),
    scopedEntity,
  });
}

/** Remove a typed edge. Omit `relation` to drop all edges to the target. */
export function removeIdeaEdge(
  sourceId: string,
  targetId: string,
  relation?: string,
  scopedEntity?: string | null,
): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>(`/ideas/${encodeURIComponent(sourceId)}/edges`, {
    method: "DELETE",
    body: JSON.stringify(relation ? { target_id: targetId, relation } : { target_id: targetId }),
    scopedEntity,
  });
}
