import { describe, expect, it } from "vitest";
import { buildAgentDirectory } from "@/api/agents";
import { normalizeCompanyRoots } from "@/api/companies";
import { publicWebsitePath, publicWebsiteUrl, publicWebsiteSlug } from "@/lib/publicWebsite";
import { companyEmailAddress } from "@/lib/companyEmail";

describe("company API normalization", () => {
  it("maps company roots into UI companies and drops invalid rows", () => {
    expect(
      normalizeCompanyRoots({
        companies: [
          {
            id: "company_1",
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
        id: "company_1",
        name: "Acme",
        type: "company",
        status: "active",
        avatar: undefined,
        color: undefined,
        budget_usd: 100,
        created_at: "2026-01-01T00:00:00Z",
        last_active: undefined,
        company_id: undefined,
        company_address: undefined,
        slug: undefined,
        creator_address: undefined,
        email_address: undefined,
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
        id: "company_1",
        name: "Launch Name",
        slug: "launch-name",
      }),
    ).toBe("https://launch-name.aeqi.ai/");
  });

  it("derives the launch slug from the company name before falling back to address", () => {
    expect(
      publicWebsiteSlug({
        id: "company_1",
        name: "Horizon Labs",
        company_address: "0xabc123",
      }),
    ).toBe("horizon-labs");
  });

  it("keeps the legacy slash path separate from the public subdomain URL", () => {
    expect(publicWebsitePath({ id: "company_1", name: "Horizon Labs" })).toBe("/horizon-labs");
  });

  it("derives the company email from the website slug", () => {
    expect(companyEmailAddress({ id: "company_1", name: "Horizon Labs" })).toBe(
      "hello@horizon-labs.aeqi.ai",
    );
  });

  it("uses backend-provided company email when present", () => {
    expect(
      companyEmailAddress({
        id: "company_1",
        name: "Horizon Labs",
        email_address: "founders@horizon-labs.aeqi.ai",
      }),
    ).toBe("founders@horizon-labs.aeqi.ai");
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
              company_id: "ent_1",
              name: "Acme Runtime",
              status: "running",
              budget_usd: 42,
            },
            {
              id: "agent_child",
              company_id: "ent_1",
              name: "Ops",
              status: "idle",
            },
          ],
        },
      ),
    ).toEqual([
      {
        id: "agent_root",
        company_id: "ent_1",
        name: "Acme Runtime",
        status: "running",
        budget_usd: 42,
      },
      {
        id: "agent_child",
        company_id: "ent_1",
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
