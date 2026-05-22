import { describe, expect, it } from "vitest";
import { buildRoleContexts, type RoleBundle } from "@/lib/trustRoleContext";
import type { Role, Trust } from "@/lib/types";

function trust(id: string, name = id): Trust {
  return {
    id,
    name,
    type: "trust",
    status: "active",
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

function role(overrides: Partial<Role> & Pick<Role, "id" | "trust_id" | "occupant_kind">): Role {
  return {
    id: overrides.id,
    trust_id: overrides.trust_id,
    title: overrides.title ?? "Director",
    occupant_kind: overrides.occupant_kind,
    occupant_id: overrides.occupant_id ?? null,
    role_type: overrides.role_type ?? "director",
    founder: overrides.founder ?? false,
    grants: overrides.grants ?? [],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: null,
  };
}

describe("buildRoleContexts", () => {
  it("keeps legacy root-owned human roles selectable", () => {
    const rootTrust = trust("trust-root", "53455");
    const bundles: RoleBundle[] = [
      {
        trust: rootTrust,
        roles: [
          role({
            id: "founder",
            trust_id: rootTrust.id,
            title: "Founder",
            occupant_kind: "human",
            occupant_id: rootTrust.id,
            founder: true,
          }),
        ],
        edges: [],
      },
    ];

    const contexts = buildRoleContexts(bundles, "user-operator", [rootTrust.id]);

    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.trust.id).toBe(rootTrust.id);
    expect(contexts[0]?.role.id).toBe("founder");
    expect(contexts[0]?.route[0]?.relation).toBe("direct");
  });

  it("builds nested TRUST role paths from a controlled root TRUST", () => {
    const rootTrust = trust("trust-root", "53455");
    const aeTrust = trust("trust-aeqi", "AEQI");
    const bundles: RoleBundle[] = [
      {
        trust: rootTrust,
        roles: [
          role({
            id: "founder",
            trust_id: rootTrust.id,
            title: "Founder",
            occupant_kind: "human",
            occupant_id: "user-operator",
            founder: true,
          }),
        ],
        edges: [],
      },
      {
        trust: aeTrust,
        roles: [
          role({
            id: "aeqi-director",
            trust_id: aeTrust.id,
            title: "Director",
            occupant_kind: "trust",
            occupant_id: rootTrust.id,
          }),
        ],
        edges: [],
      },
    ];

    const contexts = buildRoleContexts(bundles, "user-operator", [rootTrust.id]);

    const directorContexts = contexts.filter((context) => context.role.id === "aeqi-director");
    expect(contexts.some((context) => context.role.id === "founder")).toBe(true);
    expect(directorContexts).toHaveLength(2);
    expect(directorContexts.map((context) => context.route.at(-1)?.relation).sort()).toEqual([
      "identity",
      "nested",
    ]);
    expect(directorContexts.every((context) => context.routeCount === 2)).toBe(true);
  });
});
