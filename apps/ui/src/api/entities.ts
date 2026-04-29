import { apiRequest } from "@/api/client";
import type { Entity } from "@/lib/types";

export interface EntitiesResponse {
  entities?: Array<Record<string, unknown>>;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Decode the platform's `GET /api/entities` payload. The response shape
 *  is `{entities: [{id, display_name, running, ...}]}` — `display_name`
 *  is the human-readable label, `id` is the canonical UUID. Items with
 *  no `display_name` are stale or in-flight placements; they're filtered
 *  out so the switcher doesn't render unnamed rows. */
export function normalizeEntityRoots(data: EntitiesResponse | null | undefined): Entity[] {
  const raw = Array.isArray(data?.entities) ? data.entities : [];
  return raw
    .map<Entity>((entity) => ({
      id: stringValue(entity.id),
      name: stringValue(entity.display_name),
      type: "company",
      status: entity.running === true ? "active" : "paused",
      avatar: optionalString(entity.avatar),
      color: optionalString(entity.color),
      budget_usd: typeof entity.budget_usd === "number" ? entity.budget_usd : undefined,
      created_at: stringValue(entity.created_at, new Date(0).toISOString()),
      last_active: optionalString(entity.last_active),
    }))
    .filter((entity) => entity.id && entity.name);
}

export async function listEntityRoots(): Promise<Entity[]> {
  const data = await apiRequest<EntitiesResponse>("/entities");
  return normalizeEntityRoots(data);
}

export function getEntitiesRaw(): Promise<EntitiesResponse> {
  return apiRequest<EntitiesResponse>("/entities");
}
