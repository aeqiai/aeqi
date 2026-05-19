import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import EconomyPage from "@/pages/EconomyPage";
import { api } from "@/lib/api";
import { useEntitiesQuery } from "@/queries/entities";
import type { Role, Trust } from "@/lib/types";

vi.mock("@/queries/entities", () => ({
  useEntitiesQuery: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    getRoles: vi.fn(),
    getLaunchStatus: vi.fn(),
  },
}));

const TRUSTS: Trust[] = [
  {
    id: "alpha",
    name: "Alpha Trust",
    type: "trust",
    status: "active",
    created_at: "2026-05-01T00:00:00Z",
    tagline: "Public operating company",
    public: true,
    trust_address: "9AlphaTrust111111111111111111111111111111111",
    plan: "growth",
  },
  {
    id: "beta",
    name: "Beta Trust",
    type: "trust",
    status: "active",
    created_at: "2026-05-03T00:00:00Z",
    tagline: "Private lab",
    public: false,
  },
];

const OPEN_ROLE: Role = {
  id: "role-cfo",
  trust_id: "alpha",
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
  trust_id: "alpha",
  title: "Director",
  occupant_kind: "human",
  occupant_id: "user-1",
  role_type: "director",
  founder: true,
  grants: [],
  created_at: "2026-05-02T00:00:00Z",
};

function renderEconomy(entry = "/economy") {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/economy" element={<EconomyPage />} />
          <Route path="/economy/:tab" element={<EconomyPage />} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  );
}

describe("EconomyPage", () => {
  beforeEach(() => {
    vi.mocked(useEntitiesQuery).mockReturnValue({
      data: TRUSTS,
      isLoading: false,
    } as never);
    vi.mocked(api.getRoles).mockImplementation(async (trustId: string) => ({
      ok: true,
      roles: trustId === "alpha" ? [OPEN_ROLE, FILLED_ROLE] : [],
      edges: [],
    }));
    vi.mocked(api.getLaunchStatus).mockImplementation(async (trustId: string) => ({
      ok: true,
      trust_id: trustId,
      display_name: trustId,
      placement_status: "active",
      trust_status: "active",
      trust_address: trustId === "alpha" ? (TRUSTS[0].trust_address ?? null) : null,
      trust_error: null,
      runtime_error: null,
      org_lifecycle: "active",
      milestones: {
        creating_trust: { reached: true, at: null },
        signing_on_solana: { reached: true, at: null },
        loading_roles: { reached: true, at: null },
        spawning_agent: { reached: true, at: null },
      },
      unifutures:
        trustId === "alpha"
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

  it("renders the trust registry overview with public profile affordance", async () => {
    renderEconomy();

    expect(screen.getByRole("heading", { level: 1, name: "Economy" })).toBeInTheDocument();
    expect(screen.getByText("Alpha Trust")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Profile" })).toHaveAttribute("href", "/alpha");

    await waitFor(() => {
      expect(screen.getByText("Open roles")).toBeInTheDocument();
    });
    expect(api.getRoles).toHaveBeenCalledWith("alpha");
    expect(api.getLaunchStatus).toHaveBeenCalledWith("alpha");
  });

  it("shows indexed genesis curves on the pools tab", async () => {
    renderEconomy("/economy/pools");

    expect(screen.getByRole("heading", { name: "Liquidity pools" })).toBeInTheDocument();
    expect(await screen.findByText("Genesis curve")).toBeInTheDocument();
    expect(screen.getByText("Alpha Trust")).toBeInTheDocument();
  });

  it("filters indexed pools by pool and trust fields", async () => {
    renderEconomy("/economy/pools");

    expect(await screen.findByText("Genesis curve")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Search trusts" }), {
      target: { value: "quote111" },
    });

    expect(screen.getByText("Genesis curve")).toBeInTheDocument();
    expect(screen.getByText("0 trusts / 1 pools / 0 roles")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Search trusts" }), {
      target: { value: "Beta" },
    });

    expect(screen.getByText("No matching pools")).toBeInTheDocument();
  });

  it("shows vacant trust roles on the roles tab", async () => {
    renderEconomy("/economy/roles");

    expect(screen.getByRole("heading", { name: "Open roles" })).toBeInTheDocument();
    expect(await screen.findByText("CFO")).toBeInTheDocument();
    expect(screen.queryByText("Director")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeInTheDocument();
  });

  it("filters open roles by role and trust fields", async () => {
    renderEconomy("/economy/roles");

    expect(await screen.findByText("CFO")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Search trusts" }), {
      target: { value: "operational" },
    });

    expect(screen.getByText("CFO")).toBeInTheDocument();
    expect(screen.getByText("0 trusts / 0 pools / 1 roles")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Search trusts" }), {
      target: { value: "Beta" },
    });

    expect(screen.getByText("No matching roles")).toBeInTheDocument();
  });

  it("keeps the funding lane honest while the funding index is absent", () => {
    renderEconomy("/economy/funding");

    expect(screen.getByRole("heading", { name: "Funding rounds" })).toBeInTheDocument();
    expect(screen.getByText("No indexed funding rounds yet")).toBeInTheDocument();
  });
});
