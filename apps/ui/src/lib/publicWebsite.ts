import type { Trust } from "@/lib/types";

type PublicWebsiteTrust = Pick<Trust, "id" | "trust_address" | "slug"> &
  Partial<Pick<Trust, "name">>;

export type { PublicWebsiteTrust };

/**
 * Canonical public website identity for a trust.
 *
 * The public trust surface is the website. Prefer the public slug when the
 * backend has minted one; otherwise derive the launch slug from the unique
 * trust name. Address/id fallback only exists for legacy rows that predate
 * launch-time website identity.
 */
export function publicWebsitePath(trust: PublicWebsiteTrust): string {
  const slug = publicWebsiteSlug(trust);
  return `/${encodeURIComponent(slug)}`;
}

export function publicWebsiteDomain(trust: PublicWebsiteTrust): string {
  return `${publicWebsiteSlug(trust)}.aeqi.ai`;
}

export function publicWebsiteUrl(trust: PublicWebsiteTrust): string {
  return `https://${publicWebsiteDomain(trust)}/`;
}

export function publicWebsiteSlug(trust: PublicWebsiteTrust): string {
  return (
    normalizeWebsiteSlug(trust.slug) ??
    normalizeWebsiteSlug(trust.name) ??
    trust.trust_address ??
    trust.id
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
