import { describe, expect, it } from "vitest";
import { defaultCompanyName, launchNameCandidates } from "@/pages/CompanySetupPage";
import type { SingleBlueprint } from "@/lib/types";

const standardBlueprint: SingleBlueprint = {
  slug: "operating-company",
  name: "Operating Company",
  root: {
    name: "aeqi Assistant",
  },
};

const defaultBlueprint: SingleBlueprint = {
  slug: "aeqi",
  name: "First Company",
  root: {
    name: "Chief of Staff",
  },
};

describe("defaultCompanyName", () => {
  it("uses the operator identity for standard launch instead of the reusable default agent", () => {
    expect(
      defaultCompanyName({ name: "Operator", email: "operator@aeqi.local" }, standardBlueprint),
    ).toBe("Operator COMPANY");
  });

  it("keeps the default first-run launch name personal", () => {
    expect(
      defaultCompanyName({ name: "Operator", email: "operator@aeqi.local" }, defaultBlueprint),
    ).toBe("Operator's COMPANY");
  });

  it("derives a short list of fallback launch names from the same base identity", () => {
    expect(
      launchNameCandidates({ name: "Operator", email: "operator@aeqi.local" }, standardBlueprint),
    ).toEqual([
      "Operator COMPANY",
      "Operator COMPANY Labs",
      "Operator COMPANY Studio",
      "Operator COMPANY One",
      "Operator COMPANY Works",
      "Operator COMPANY Build",
      "Operator COMPANY HQ",
    ]);
  });
});
