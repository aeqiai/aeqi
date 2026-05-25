import { describe, expect, it } from "vitest";
import type { SingleBlueprint } from "@/lib/types";
import { countBlueprintStructures, describeBlueprintStructures } from "@/lib/blueprintStructures";

const MULTI: SingleBlueprint = {
  slug: "multi-structure",
  name: "Multi Structure",
  root: {
    name: "CEO",
  },
  seed_roles: [
    { key: "ceo", title: "CEO", default_occupant_agent: "default" },
    { key: "cto", title: "CTO", default_occupant_agent: "default" },
    { key: "advisory-board", title: "Advisory Board", default_occupant_agent: null },
    { key: "legal-advisor", title: "Legal Advisor", default_occupant_agent: null },
  ],
  seed_role_edges: [
    { parent: "ceo", child: "cto" },
    { parent: "advisory-board", child: "legal-advisor" },
  ],
};

const FALLBACK: SingleBlueprint = {
  slug: "fallback",
  name: "Fallback",
  root: {
    name: "Founder",
  },
  seed_agents: [{ name: "Scribe", role: "Scribe" }],
};

describe("blueprintStructures", () => {
  it("groups disconnected role trees into separate structures", () => {
    const structures = describeBlueprintStructures(MULTI);
    expect(countBlueprintStructures(MULTI)).toBe(2);
    expect(structures).toHaveLength(2);
    expect(structures[0].title).toBe("CEO");
    expect(structures[1].title).toBe("Advisory Board");
    expect(structures[1].roles.map((role) => role.title)).toEqual([
      "Advisory Board",
      "Legal Advisor",
    ]);
  });

  it("falls back to one implicit structure when no roles are declared", () => {
    const structures = describeBlueprintStructures(FALLBACK);
    expect(countBlueprintStructures(FALLBACK)).toBe(1);
    expect(structures).toHaveLength(1);
    expect(structures[0].title).toBe("Founder");
    expect(structures[0].rootKeys).toEqual(["default"]);
    expect(structures[0].layers[0][0].title).toBe("Founder");
  });
});
