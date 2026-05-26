import { describe, expect, it } from "vitest";
import { buildAgentDirectory } from "@/api/agents";
import { normalizeTrustRoots } from "@/api/trusts";
import { publicWebsitePath, publicWebsiteUrl, publicWebsiteSlug } from "@/lib/publicWebsite";

describe("trust API normalization", () => {
  it("maps trust roots into UI trusts and drops invalid rows", () => {
    expect(
      normalizeTrustRoots({
        trusts: [
          {
            id: "trust_1",
            display_name: "Acme",
            running: true,
            created_at: "2026-01-01T00:00:00Z",
            budget_usd: 100,
          },
          { display_name: "missing id" },
        ],
      }),
    ).toEqual([
      {
        id: "trust_1",
        name: "Acme",
        type: "trust",
        status: "active",
        avatar: undefined,
        color: undefined,
        budget_usd: 100,
        created_at: "2026-01-01T00:00:00Z",
        last_active: undefined,
        trust_id: undefined,
        trust_address: undefined,
        slug: undefined,
        creator_address: undefined,
        agent_id: undefined,
        placement_type: undefined,
        tagline: undefined,
        public: false,
        plan: undefined,
        placement_status: undefined,
        launch_state: undefined,
        launch_error: undefined,
      },
    ]);
  });
});

describe("public website identity", () => {
  it("uses the persisted slug when present", () => {
    expect(
      publicWebsiteUrl({
        id: "trust_1",
        name: "Launch Name",
        slug: "launch-name",
      }),
    ).toBe("https://launch-name.aeqi.ai/");
  });

  it("derives the launch slug from the trust name before falling back to address", () => {
    expect(
      publicWebsiteSlug({
        id: "trust_1",
        name: "Horizon Labs",
        trust_address: "0xabc123",
      }),
    ).toBe("horizon-labs");
  });

  it("keeps the legacy slash path separate from the public subdomain URL", () => {
    expect(publicWebsitePath({ id: "trust_1", name: "Horizon Labs" })).toBe("/horizon-labs");
  });
});

describe("agent API normalization", () => {
  it("returns only real agents from agentsData; entities param is ignored", () => {
    expect(
      buildAgentDirectory(
        {
          entities: [
            {
              id: "ent_1",
              agent_id: "agent_root",
              display_name: "Acme",
              running: true,
            },
          ],
        },
        {
          agents: [
            {
              id: "agent_root",
              trust_id: "ent_1",
              name: "Acme Runtime",
              status: "running",
              budget_usd: 42,
            },
            {
              id: "agent_child",
              trust_id: "ent_1",
              name: "Ops",
              status: "idle",
            },
          ],
        },
      ),
    ).toEqual([
      {
        id: "agent_root",
        trust_id: "ent_1",
        name: "Acme Runtime",
        status: "running",
        budget_usd: 42,
      },
      {
        id: "agent_child",
        trust_id: "ent_1",
        name: "Ops",
        status: "idle",
      },
    ]);
  });

  it("does not synthesize a fake agent row when entities are provided but agentsData is empty", () => {
    expect(
      buildAgentDirectory(
        {
          entities: [
            {
              id: "ent_1",
              agent_id: "agent_root",
              display_name: "Acme",
              running: true,
            },
          ],
        },
        { agents: [] },
      ),
    ).toEqual([]);
  });
});
