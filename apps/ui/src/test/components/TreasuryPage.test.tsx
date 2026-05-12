import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StrictMode } from "react";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TreasuryPage from "@/pages/TreasuryPage";
import { api } from "@/lib/api";
import { useDaemonStore } from "@/store/daemon";

// ── Wagmi mock ────────────────────────────────────────────────────────────────

// useBalance calls the RPC in production; stub it in tests so there's no real
// network dependency. The stub returns no balance by default (undefined).
vi.mock("wagmi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wagmi")>();
  return {
    ...actual,
    useBalance: vi.fn(() => ({ data: undefined, isLoading: false })),
  };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TRUST_ADDRESS = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

const ENTITY = {
  id: "entity-1",
  name: "Acme Corp",
  type: "company" as const,
  status: "active" as const,
  created_at: "2026-01-01T00:00:00Z",
  trust_address: TRUST_ADDRESS,
};

const BILLING_OVERVIEW = {
  ok: true,
  total_monthly_cents: 14900,
  total_annual_cents: 178800,
  currency: "usd",
  companies: [
    {
      name: "Acme Corp",
      agent_id: "entity-1",
      plan: "growth" as const,
      stripe_subscription_id: "sub_123",
      status: "active" as const,
      next_charge_at: "2026-06-01T00:00:00Z",
    },
  ],
  payment_method_last4: "4242",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderPage(entityId = "entity-1") {
  return render(
    <StrictMode>
      <MemoryRouter>
        <TreasuryPage entityId={entityId} />
      </MemoryRouter>
    </StrictMode>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("TreasuryPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useDaemonStore.setState({
      entities: [ENTITY],
      agents: [],
      quests: [],
      events: [],
    } as never);
    // Default: billing resolves fine.
    vi.spyOn(api, "getBillingOverview").mockResolvedValue(BILLING_OVERVIEW);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the Treasury heading", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: /treasury/i })).toBeInTheDocument();
  });

  it("shows the contract info row with chain name when trust_address is present", async () => {
    renderPage();
    // The contract info row shows a truncated address and the chain label.
    // Default CHAIN_NAME is "anvil" (no VITE_CHAIN_NAME env in tests).
    await waitFor(() => {
      expect(screen.getByText(/anvil/i)).toBeInTheDocument();
    });
    // Truncated address appears in the contract info row (and possibly in the holdings hint).
    expect(screen.getAllByText(/0xdead/).length).toBeGreaterThan(0);
  });

  it("shows Holdings and Recent transfers section labels", async () => {
    renderPage();
    // Section labels are uppercase via CSS, but the DOM text is lowercase.
    await waitFor(() => {
      expect(screen.getByText(/holdings/i)).toBeInTheDocument();
      expect(screen.getByText(/recent transfers/i)).toBeInTheDocument();
    });
  });

  it("shows empty-state copy in both sections when indexer returns no data", async () => {
    renderPage();
    // useTreasury will hit the indexer, get field-not-found errors for
    // transfers, and [] from the treasury balances query (no data seeded).
    // Both sections land on the empty state.
    await waitFor(
      () => {
        // Holdings empty state shows the zero-balance line.
        expect(screen.getByText("0 ETH · 0 USDC")).toBeInTheDocument();
        // Transfers empty state.
        expect(screen.getByText(/no transfers yet/i)).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it("shows the billing card after a successful overview fetch", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Company subscription")).toBeInTheDocument();
    });
    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.getByText(/manage billing/i)).toBeInTheDocument();
  });

  it("shows an EmptyState when the entity has no subscription", async () => {
    vi.spyOn(api, "getBillingOverview").mockResolvedValue({
      ok: true,
      total_monthly_cents: 0,
      total_annual_cents: 0,
      currency: "usd",
      companies: [],
      payment_method_last4: null,
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/no active plan/i)).toBeInTheDocument();
    });
  });

  it("shows the billing error message when the API rejects", async () => {
    vi.spyOn(api, "getBillingOverview").mockRejectedValue(new Error("network timeout"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/couldn't load billing/i)).toBeInTheDocument();
      expect(screen.getByText(/network timeout/i)).toBeInTheDocument();
    });
  });

  it("does not render the contract row when no trust_address is set", async () => {
    useDaemonStore.setState({
      entities: [{ ...ENTITY, trust_address: undefined }],
      agents: [],
      quests: [],
      events: [],
    } as never);

    renderPage();

    await screen.findByRole("heading", { name: /treasury/i });
    // Contract info row is only shown when indexerEnabled() && trustAddress are set.
    // With no trust_address, no contract row renders.
    expect(screen.queryByText(/0xdead/i)).not.toBeInTheDocument();
  });

  it("renders the Resource pack section", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/resource pack/i)).toBeInTheDocument();
      expect(screen.getByText(/llm tokens \/ month/i)).toBeInTheDocument();
    });
  });
});
