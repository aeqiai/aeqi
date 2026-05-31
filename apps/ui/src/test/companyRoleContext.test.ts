import { describe, expect, it } from "vitest";
import {
  buildRoleContexts,
  collapseRoleContextsByTerminal,
  type RoleBundle,
} from "@/lib/companyRoleContext";
import type { Role, Company } from "@/lib/types";

function company(id: string, name = id): Company {
  return {
    id,
    name,
    type: "company",
    status: "active",
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

function role(overrides: Partial<Role> & Pick<Role, "id" | "company_id" | "occupant_kind">): Role {
  return {
    id: overrides.id,
    company_id: overrides.company_id,
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
    const rootCompany = company("company-root", "53455");
    const bundles: RoleBundle[] = [
      {
        company: rootCompany,
        roles: [
          role({
            id: "founder",
            company_id: rootCompany.id,
            title: "Founder",
            occupant_kind: "human",
            occupant_id: rootCompany.id,
            founder: true,
          }),
        ],
        edges: [],
      },
    ];

    const contexts = buildRoleContexts(bundles, "user-operator", [rootCompany.id]);

    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.company.id).toBe(rootCompany.id);
    expect(contexts[0]?.role.id).toBe("founder");
    expect(contexts[0]?.route[0]?.relation).toBe("direct");
  });

  it("builds nested COMPANY role paths from a controlled root COMPANY", () => {
    const rootCompany = company("company-root", "53455");
    const aeCompany = company("company-aeqi", "AEQI");
    const bundles: RoleBundle[] = [
      {
        company: rootCompany,
        roles: [
          role({
            id: "founder",
            company_id: rootCompany.id,
            title: "Founder",
            occupant_kind: "human",
            occupant_id: "user-operator",
            founder: true,
          }),
        ],
        edges: [],
      },
      {
        company: aeCompany,
        roles: [
          role({
            id: "aeqi-director",
            company_id: aeCompany.id,
            title: "Director",
            occupant_kind: "company",
            occupant_id: rootCompany.id,
          }),
        ],
        edges: [],
      },
    ];

    const contexts = buildRoleContexts(bundles, "user-operator", [rootCompany.id]);

    const directorContexts = contexts.filter((context) => context.role.id === "aeqi-director");
    expect(contexts.some((context) => context.role.id === "founder")).toBe(true);
    expect(directorContexts).toHaveLength(2);
    expect(directorContexts.map((context) => context.route.at(-1)?.relation).sort()).toEqual([
      "identity",
      "nested",
    ]);
    expect(directorContexts.every((context) => context.routeCount === 2)).toBe(true);
  });

  it("collapses duplicate visible options by terminal role while keeping the richer route", () => {
    const rootCompany = company("company-root", "53455");
    const aeCompany = company("company-aeqi", "AEQI");
    const bundles: RoleBundle[] = [
      {
        company: rootCompany,
        roles: [
          role({
            id: "founder",
            company_id: rootCompany.id,
            title: "Founder",
            occupant_kind: "human",
            occupant_id: "user-operator",
            founder: true,
          }),
        ],
        edges: [],
      },
      {
        company: aeCompany,
        roles: [
          role({
            id: "aeqi-director",
            company_id: aeCompany.id,
            title: "Director",
            occupant_kind: "company",
            occupant_id: rootCompany.id,
          }),
        ],
        edges: [],
      },
    ];

    const contexts = buildRoleContexts(bundles, "user-operator", [rootCompany.id]);
    const visible = collapseRoleContextsByTerminal(contexts);
    const director = visible.find((context) => context.role.id === "aeqi-director");

    expect(visible.filter((context) => context.role.id === "aeqi-director")).toHaveLength(1);
    expect(director?.route.map((segment) => segment.company.id)).toEqual([
      rootCompany.id,
      aeCompany.id,
    ]);
    expect(director?.routeCount).toBe(2);
    expect(director?.status).toBe("ambiguous");
  });
});
