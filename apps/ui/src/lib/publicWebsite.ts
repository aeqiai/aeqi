import type { Trust } from "@/lib/types";

/**
 * Canonical public website path for a trust.
 *
 * The public trust surface is the website. Prefer the public slug when the
 * backend has minted one; fall back to the trust address or id so the UI keeps
 * a stable route even while the public metadata is still settling.
 */
export function publicWebsitePath(trust: Pick<Trust, "id" | "trust_address" | "slug">): string {
  const slug = trust.slug ?? trust.trust_address ?? trust.id;
  return `/${encodeURIComponent(slug)}`;
}
