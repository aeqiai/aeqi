import { apiRequest } from "@/api/client";
import type { Company } from "@/lib/types";

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export interface CompaniesResponse {
  companies?: Array<Record<string, unknown>>;
  entities?: Array<Record<string, unknown>>;
  roots?: Array<Record<string, unknown>>;
}

/** Decode the platform's `GET /api/companies` payload. The canonical shape is
 * `{companies: [{id, display_name, running, ...}]}`. Old runtimes may still
 * return `entities` or `roots`; those aliases are accepted only at this
 * boundary so the rest of the app can speak COMPANY. */
export function normalizeCompanyRoots(data: CompaniesResponse | null | undefined): Company[] {
  const raw = Array.isArray(data?.companies)
    ? data.companies
    : Array.isArray(data?.entities)
      ? data.entities
      : Array.isArray(data?.roots)
        ? data.roots
        : [];
  return raw
    .map<Company>((company) => ({
      id: stringValue(company.id),
      name: stringValue(company.display_name, stringValue(company.name)),
      type: "company",
      status: company.running === true ? "active" : "paused",
      avatar: optionalString(company.avatar),
      color: optionalString(company.color),
      budget_usd: typeof company.budget_usd === "number" ? company.budget_usd : undefined,
      created_at: stringValue(company.created_at, new Date(0).toISOString()),
      last_active: optionalString(company.last_active),
      company_id: optionalString(company.company_id),
      company_address: optionalString(company.company_address),
      slug: optionalString(company.slug),
      email_address: optionalString(company.email_address),
      creator_address: optionalString(company.creator_address),
      agent_id: optionalString(company.agent_id),
      placement_type: optionalString(company.placement_type),
      tagline: optionalString(company.tagline),
      public: company.public === true,
      plan: optionalString(company.plan),
      placement_status: optionalString(company.placement_status),
      launch_state: optionalString(company.launch_state),
      launch_error: optionalString(company.launch_error),
    }))
    .filter((company) => company.id && company.name);
}

export async function listCompanyRoots(): Promise<Company[]> {
  const data = await apiRequest<CompaniesResponse>("/companies", { scopedEntity: false });
  return normalizeCompanyRoots(data);
}

export function getCompaniesRaw(): Promise<CompaniesResponse> {
  return apiRequest<CompaniesResponse>("/companies", { scopedEntity: false });
}
