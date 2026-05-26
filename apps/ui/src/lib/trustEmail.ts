import type { Trust } from "@/lib/types";
import { publicWebsiteDomain } from "@/lib/publicWebsite";

type TrustEmailIdentity = Pick<Trust, "id" | "trust_address" | "slug" | "email_address"> &
  Partial<Pick<Trust, "name">>;

export function trustEmailDomain(trust: TrustEmailIdentity): string {
  return publicWebsiteDomain(trust);
}

export function trustEmailAddress(trust: TrustEmailIdentity): string {
  return trust.email_address ?? `hello@${trustEmailDomain(trust)}`;
}
