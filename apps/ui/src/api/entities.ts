import { apiRequest } from "@/api/client";
import type { Entity } from "@/lib/types";

export interface EntitiesResponse {
  roots?: Array<Record<string, unknown>>;
  projects?: Array<Record<string, unknown>>;
  agent_spawns?: Array<Record<string, unknown>>;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function normalizeEntityRoots(data: EntitiesResponse | null | undefined): Entity[] {
  const raw = Array.isArray(data?.roots) ? data.roots : [];
  return raw
    .map<Entity>((root) => ({
      id: stringValue(root.id),
      name: stringValue(root.name),
      type: "company",
      status: root.running === true ? "active" : "paused",
      avatar: optionalString(root.avatar),
      color: optionalString(root.color),
      budget_usd: typeof root.budget_usd === "number" ? root.budget_usd : undefined,
      created_at: stringValue(root.created_at, new Date(0).toISOString()),
      last_active: optionalString(root.last_active),
    }))
    .filter((entity) => entity.id);
}

export async function listEntityRoots(): Promise<Entity[]> {
  const data = await apiRequest<EntitiesResponse>("/entities");
  return normalizeEntityRoots(data);
}

export function getEntitiesRaw(): Promise<EntitiesResponse> {
  return apiRequest<EntitiesResponse>("/entities");
}
