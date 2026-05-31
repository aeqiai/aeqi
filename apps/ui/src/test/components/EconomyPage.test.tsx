import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import MarketsPage from "@/pages/EconomyPage";
import { api } from "@/lib/api";
import { useEntitiesQuery } from "@/queries/entities";
import type { Role, Company } from "@/lib/types";

vi.mock("@/queries/entities", () => ({
  useEntitiesQuery: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    getRoles: vi.fn(),
    getCapTable: vi.fn(),
    getLaunchStatus: vi.fn(),
  },
}));

const COMPANIES: Company[] = [
  {
    id: "alpha",
    name: "Alpha Company",
    type: "company",
    status: "active",
    created_at: "2026-05-01T00:00:00Z",
    tagline: "Public operating company",
    public: true,
    company_address: "9AlphaCompany111111111111111111111111111111111",
    plan: "growth",
  },
  {
    id: "beta",
    name: "Beta Company",
    type: "company",
    status: "active",
    created_at: "2026-05-03T00:00:00Z",
    tagline: "Private lab",
    public: false,
  },
];

const OPEN_ROLE: Role = {
  id: "role-cfo",
  company_id: "alpha",
  title: "CFO",
  occupant_kind: "vacant",
  occupant_id: null,
  role_type: "operational",
  founder: false,
  grants: [],
  created_at: "2026-05-04T00:00:00Z",
};

const FILLED_ROLE: Role = {
  id: "role-director",
  company_id: "alpha",
  title: "Director",
  occupant_kind: "human",
  occupant_id: "user-1",
  role_type: "director",
  founder: true,
  grants: [],
  created_at: "2026-05-02T00:00:00Z",
};

const ALPHA_CAP_TABLE = [
  {
    id: "cap-founder",
    company_id: "alpha",
    allocation_key: "founder_vesting_common",
    holder_kind: "creator",
    holder_id: "user-founder",
    security_type: "vesting_common",
    basis_points: 8000,
    vesting_months: 48,
    cliff_months: 12,
    created_at: "2026-05-04T00:00:00Z",
  },
  {
    id: "cap-option-pool",
    company_id: "alpha",
    allocation_key: "option_pool",
    holder_kind: "unassigned",
    holder_id: null,
    security_type: "option_pool",
    basis_points: 2000,
    vesting_months: null,
    cliff_months: null,
    created_at: "2026-05-04T00:00:00Z",
  },
];

function renderMarkets(entry = "/markets") {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/markets" element={<MarketsPage />} />
          <Route path="/markets/:tab" element={<MarketsPage />} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  );
}

describe("MarketsPage", () => {
  beforeEach(() => {
    vi.mocked(useEntitiesQuery).mockReturnValue({
      data: COMPANIES,
      isLoading: false,
    } as never);
    vi.mocked(api.getRoles).mockImplementation(async (companyId: string) => ({
      ok: true,
      roles: companyId === "alpha" ? [OPEN_ROLE, FILLED_ROLE] : [],
      edges: [],
    }));
    vi.mocked(api.getCapTable).mockImplementation(async (companyId: string) => ({
      ok: true,
      company_id: companyId,
      entries: companyId === "alpha" ? ALPHA_CAP_TABLE : [],
    }));
    vi.mocked(api.getLaunchStatus).mockImplementation(async (companyId: string) => ({
      ok: true,
      company_id: companyId,
      display_name: companyId,
      email_address: `hello@${companyId}.aeqi.ai`,
      placement_status: "active",
      company_status: "active",
      company_address: companyId === "alpha" ? (COMPANIES[0].company_address ?? null) : null,
      company_error: null,
      runtime_error: null,
      org_lifecycle: "active",
      milestones: {
        creating_company: { reached: true, at: null },
        signing_on_solana: { reached: true, at: null },
        loading_roles: { reached: true, at: null },
        spawning_agent: { reached: true, at: null },
      },
      unifutures:
        companyId === "alpha"
          ? {
              asset_mint: "asset111111111111111111111111111111111111",
              quote_mint: "quote111111111111111111111111111111111111",
              curve: "curve111111111111111111111111111111111111",
              curve_asset_vault: "assetVault",
              curve_quote_vault: "quoteVault",
              buy_amount: 1000,
              max_cost: 250,
            }
          : null,
    }));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the company registry overview with public profile affordance", async () => {
    renderMarkets();

    expect(screen.getByRole("heading", { level: 1, name: "Markets" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Capital readiness" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cap-table seed rows" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Browse Templates" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Start from a Template" })).toBeInTheDocument();
    expect(screen.getByText("Alpha Company")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Profile" })).toHaveAttribute("href", "/alpha");

    await waitFor(() => {
      expect(screen.getByText("Open roles")).toBeInTheDocument();
    });
    expect(screen.getByText("Founder vesting")).toBeInTheDocument();
    expect(screen.getAllByText("Option pool").length).toBeGreaterThan(0);
    expect(screen.getByText("80.00%")).toBeInTheDocument();
    expect(screen.getByText("20.00%")).toBeInTheDocument();
    expect(api.getRoles).toHaveBeenCalledWith("alpha");
    expect(api.getCapTable).toHaveBeenCalledWith("alpha");
    expect(api.getLaunchStatus).toHaveBeenCalledWith("alpha");
  });

  it("flags on-chain companies when launch status has no liquidity seed surface", async () => {
    vi.mocked(useEntitiesQuery).mockReturnValue({
      data: [
        COMPANIES[0],
        {
          ...COMPANIES[1],
          company_address: "9BetaCompany111111111111111111111111111111111",
        },
      ],
      isLoading: false,
    } as never);

    renderMarkets();

    expect(await screen.findByText("Liquidity seed not confirmed")).toBeInTheDocument();
    expect(
      screen.getByText(/1 on-chain COMPANY has no Unifutures seed surface/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/must stay quiet about live liquidity and funding/i),
    ).toBeInTheDocument();
  });

  it("shows indexed genesis curves on the pools tab", async () => {
    renderMarkets("/markets/pools");

    expect(screen.getByRole("heading", { name: "Liquidity pools" })).toBeInTheDocument();
    expect(await screen.findByText("Genesis curve")).toBeInTheDocument();
    expect(screen.getByText("Alpha Company")).toBeInTheDocument();
  });

  it("filters indexed pools by pool and company fields", async () => {
    renderMarkets("/markets/pools");

    expect(await screen.findByText("Genesis curve")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Search companies" }), {
      target: { value: "quote111" },
    });

    expect(screen.getByText("Genesis curve")).toBeInTheDocument();
    expect(screen.getByText("0 companies / 1 pools / 0 allocations / 0 roles")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Search companies" }), {
      target: { value: "Beta" },
    });

    expect(screen.getByText("No matching pools")).toBeInTheDocument();
  });

  it("filters cap-table seed rows by allocation and security fields", async () => {
    renderMarkets();

    expect(await screen.findByText("Founder vesting")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Search companies" }), {
      target: { value: "option_pool" },
    });

    expect(screen.getAllByText("Option pool").length).toBeGreaterThan(0);
    expect(screen.queryByText("Founder vesting")).not.toBeInTheDocument();
    expect(screen.getByText("0 companies / 0 pools / 1 allocations / 0 roles")).toBeInTheDocument();
  });

  it("shows vacant company roles on the roles tab", async () => {
    renderMarkets("/markets/roles");

    expect(screen.getByRole("heading", { name: "Open roles" })).toBeInTheDocument();
    expect(await screen.findByText("CFO")).toBeInTheDocument();
    expect(screen.queryByText("Director")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeInTheDocument();
  });

  it("filters open roles by role and company fields", async () => {
    renderMarkets("/markets/roles");

    expect(await screen.findByText("CFO")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Search companies" }), {
      target: { value: "operational" },
    });

    expect(screen.getByText("CFO")).toBeInTheDocument();
    expect(screen.getByText("0 companies / 0 pools / 0 allocations / 1 roles")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Search companies" }), {
      target: { value: "Beta" },
    });

    expect(screen.getByText("No matching roles")).toBeInTheDocument();
  });

  it("keeps the funding lane honest while the funding index is absent", () => {
    renderMarkets("/markets/funding");

    expect(screen.getByRole("heading", { name: "Funding rounds" })).toBeInTheDocument();
    expect(screen.getByText("No indexed funding rounds yet")).toBeInTheDocument();
  });
});
