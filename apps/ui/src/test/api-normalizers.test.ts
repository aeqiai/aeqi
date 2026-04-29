import { describe, expect, it } from "vitest";
import { buildAgentDirectory } from "@/api/agents";
import { normalizeEntityRoots } from "@/api/entities";

describe("entity API normalization", () => {
  it("maps entity roots into UI entities and drops invalid rows", () => {
    expect(
      normalizeEntityRoots({
        roots: [
          {
            id: "ent_1",
            name: "Acme",
            running: true,
            created_at: "2026-01-01T00:00:00Z",
            budget_usd: 100,
          },
          { name: "missing id" },
        ],
      }),
    ).toEqual([
      {
        id: "ent_1",
        name: "Acme",
        type: "company",
        status: "active",
        avatar: undefined,
        color: undefined,
        budget_usd: 100,
        created_at: "2026-01-01T00:00:00Z",
        last_active: undefined,
      },
    ]);
  });
});

describe("agent API normalization", () => {
  it("synthesizes root agents and lets scoped agent records win by id", () => {
    expect(
      buildAgentDirectory(
        {
          roots: [
            {
              id: "ent_1",
              agent_id: "agent_root",
              name: "Acme",
              running: true,
            },
          ],
        },
        {
          agents: [
            {
              id: "agent_root",
              entity_id: "ent_1",
              name: "Acme Runtime",
              status: "running",
              budget_usd: 42,
            },
            {
              id: "agent_child",
              entity_id: "ent_1",
              name: "Ops",
              status: "idle",
            },
          ],
        },
      ),
    ).toEqual([
      {
        id: "agent_root",
        entity_id: "ent_1",
        name: "Acme Runtime",
        status: "running",
        budget_usd: 42,
      },
      {
        id: "agent_child",
        entity_id: "ent_1",
        name: "Ops",
        status: "idle",
      },
    ]);
  });
});
