import type { Company } from "@/lib/types";
import { publicWebsiteDomain } from "@/lib/publicWebsite";

type CompanyEmailIdentity = Pick<Company, "id" | "company_address" | "slug" | "email_address"> &
  Partial<Pick<Company, "name">>;

export function companyEmailDomain(company: CompanyEmailIdentity): string {
  return publicWebsiteDomain(company);
}

export function companyEmailAddress(company: CompanyEmailIdentity): string {
  return company.email_address ?? `hello@${companyEmailDomain(company)}`;
}
