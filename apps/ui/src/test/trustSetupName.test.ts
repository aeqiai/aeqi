import { describe, expect, it } from "vitest";
import { defaultTrustName } from "@/pages/TrustSetupPage";
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
    name: "aeqi Assistant",
  },
};

describe("defaultTrustName", () => {
  it("uses the operator identity for standard launch instead of the reusable blueprint root", () => {
    expect(
      defaultTrustName({ name: "Operator", email: "operator@aeqi.local" }, standardBlueprint),
    ).toBe("Operator TRUST");
  });

  it("keeps the default first-run launch name personal", () => {
    expect(
      defaultTrustName({ name: "Operator", email: "operator@aeqi.local" }, defaultBlueprint),
    ).toBe("Operator's TRUST");
  });
});
