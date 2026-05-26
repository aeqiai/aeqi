import { apiRequest } from "@/api/client";
import type { Trust } from "@/lib/types";

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export interface TrustsResponse {
  trusts?: Array<Record<string, unknown>>;
  entities?: Array<Record<string, unknown>>;
  roots?: Array<Record<string, unknown>>;
}

/** Decode the platform's `GET /api/trusts` payload. The canonical shape is
 * `{trusts: [{id, display_name, running, ...}]}`. Old runtimes may still
 * return `entities` or `roots`; those aliases are accepted only at this
 * boundary so the rest of the app can speak TRUST. */
export function normalizeTrustRoots(data: TrustsResponse | null | undefined): Trust[] {
  const raw = Array.isArray(data?.trusts)
    ? data.trusts
    : Array.isArray(data?.entities)
      ? data.entities
      : Array.isArray(data?.roots)
        ? data.roots
        : [];
  return raw
    .map<Trust>((trust) => ({
      id: stringValue(trust.id),
      name: stringValue(trust.display_name, stringValue(trust.name)),
      type: "trust",
      status: trust.running === true ? "active" : "paused",
      avatar: optionalString(trust.avatar),
      color: optionalString(trust.color),
      budget_usd: typeof trust.budget_usd === "number" ? trust.budget_usd : undefined,
      created_at: stringValue(trust.created_at, new Date(0).toISOString()),
      last_active: optionalString(trust.last_active),
      trust_id: optionalString(trust.trust_id),
      trust_address: optionalString(trust.trust_address),
      slug: optionalString(trust.slug),
      creator_address: optionalString(trust.creator_address),
      agent_id: optionalString(trust.agent_id),
      placement_type: optionalString(trust.placement_type),
      tagline: optionalString(trust.tagline),
      public: trust.public === true,
      plan: optionalString(trust.plan),
      placement_status: optionalString(trust.placement_status),
      launch_state: optionalString(trust.launch_state),
      launch_error: optionalString(trust.launch_error),
    }))
    .filter((trust) => trust.id && trust.name);
}

export async function listTrustRoots(): Promise<Trust[]> {
  const data = await apiRequest<TrustsResponse>("/trusts");
  return normalizeTrustRoots(data);
}

export function getTrustsRaw(): Promise<TrustsResponse> {
  return apiRequest<TrustsResponse>("/trusts");
}
