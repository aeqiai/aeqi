import type { Company } from "@/lib/types";

type PublicWebsiteCompany = Pick<Company, "id" | "company_address" | "slug"> &
  Partial<Pick<Company, "name">>;

export type { PublicWebsiteCompany };

/**
 * Canonical public website identity for a company.
 *
 * The public company surface is the website. Prefer the public slug when the
 * backend has minted one; otherwise derive the launch slug from the unique
 * company name. Address/id fallback only exists for legacy rows that predate
 * launch-time website identity.
 */
export function publicWebsitePath(company: PublicWebsiteCompany): string {
  const slug = publicWebsiteSlug(company);
  return `/${encodeURIComponent(slug)}`;
}

export function publicWebsiteDomain(company: PublicWebsiteCompany): string {
  return `${publicWebsiteSlug(company)}.aeqi.ai`;
}

export function publicWebsiteUrl(company: PublicWebsiteCompany): string {
  return `https://${publicWebsiteDomain(company)}/`;
}

export function publicWebsiteSlug(company: PublicWebsiteCompany): string {
  return (
    normalizeWebsiteSlug(company.slug) ??
    normalizeWebsiteSlug(company.name) ??
    company.company_address ??
    company.id
  );
}

function normalizeWebsiteSlug(value: string | undefined): string | undefined {
  const slug = value
    ?.trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return slug && slug.length >= 4 ? slug : undefined;
}
