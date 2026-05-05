import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StrictMode } from "react";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import GovernancePage from "@/pages/GovernancePage";
import { api } from "@/lib/api";
import * as indexer from "@/lib/indexer";
import { useDaemonStore } from "@/store/daemon";
import type { Role } from "@/lib/types";

// ── Fixtures ──────────────────────────────────────────────────────────────

const ENTITY_ID = "entity-abc";
const TRUST_ADDRESS = "0xdeadbeef";

const ROLE_CEO: Role = {
  id: "role-1",
  entity_id: ENTITY_ID,
  title: "CEO",
  occupant_kind: "human",
  occupant_id: "user-1",
  role_type: "director",
  founder: true,
  grants: ["treasury.read", "settings.modify"],
  created_at: "2026-01-01T00:00:00Z",
};

const PROPOSAL_ACTIVE = {
  moduleAddress: "0xmodule",
  proposalId: "0xproposal1234567890abcdef",
  proposerAddress: "0xproposer",
  voteStart: Math.floor(Date.now() / 1000) - 3600,
  voteEnd: Math.floor(Date.now() / 1000) + 86400,
  ipfsCid: "QmFoo",
  status: "active",
  createdBlock: 100,
  title: "Expand treasury allocation",
  forVotes: String(BigInt(1500) * BigInt(1e18)),
  againstVotes: String(BigInt(500) * BigInt(1e18)),
};

// ── Helpers ───────────────────────────────────────────────────────────────

function renderPage(entityId = ENTITY_ID) {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[`/c/${entityId}/governance`]}>
        <GovernancePage entityId={entityId} />
      </MemoryRouter>
    </StrictMode>,
  );
}

function seedEntity(trustAddress?: string) {
  useDaemonStore.setState({
    entities: [
      {
        id: ENTITY_ID,
        name: "Acme Co",
        type: "company",
        status: "active",
        trust_address: trustAddress,
        created_at: "2026-01-01T00:00:00Z",
      },
    ],
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("GovernancePage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    seedEntity(TRUST_ADDRESS);
  });

  afterEach(() => {
    cleanup();
    useDaemonStore.setState({ entities: [] });
  });

  it("renders the Governance header and grant rows after roles load", async () => {
    vi.spyOn(api, "getRoles").mockResolvedValue({ ok: true, roles: [ROLE_CEO], edges: [] });
    vi.spyOn(indexer, "fetchTrustModules").mockResolvedValue([]);

    renderPage();

    expect(
      await screen.findByRole("heading", { level: 2, name: "Governance" }),
    ).toBeInTheDocument();
    // CEO role chip appears in the grant rows — find the button by role name regex.
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /CEO/ }).length).toBeGreaterThan(0);
    });
  });

  it("shows an empty state when there are no roles", async () => {
    vi.spyOn(api, "getRoles").mockResolvedValue({ ok: true, roles: [], edges: [] });
    vi.spyOn(indexer, "fetchTrustModules").mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText("No roles defined yet")).toBeInTheDocument();
  });

  it("shows roles error when api.getRoles throws", async () => {
    vi.spyOn(api, "getRoles").mockRejectedValue(new Error("offline"));
    vi.spyOn(indexer, "fetchTrustModules").mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText(/Couldn't load roles: offline/)).toBeInTheDocument();
  });

  it("shows the on-chain proposals section when proposals are present", async () => {
    vi.spyOn(api, "getRoles").mockResolvedValue({ ok: true, roles: [ROLE_CEO], edges: [] });
    vi.spyOn(indexer, "fetchTrustModules").mockResolvedValue([
      {
        trustAddress: TRUST_ADDRESS,
        moduleId: indexer.MODULE_ID.governance,
        moduleAddress: "0xmodule",
        moduleAcl: "0x",
        attachedBlock: 50,
      },
    ]);
    vi.spyOn(indexer, "fetchProposalsForModule").mockResolvedValue([PROPOSAL_ACTIVE]);
    vi.spyOn(indexer, "fetchVotingPower").mockResolvedValue(null);

    renderPage();

    expect(await screen.findByText("Expand treasury allocation")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    // Vote bar labels
    expect(screen.getByText(/For 1\.5k/)).toBeInTheDocument();
    expect(screen.getByText(/Against 500\.00/)).toBeInTheDocument();
  });

  it("shows the proposals empty state when no governance module exists", async () => {
    vi.spyOn(api, "getRoles").mockResolvedValue({ ok: true, roles: [ROLE_CEO], edges: [] });
    // trustModules returns no governance module → useGovernance sets proposals=[]
    vi.spyOn(indexer, "fetchTrustModules").mockResolvedValue([]);

    renderPage();

    // Roles section loads first.
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /CEO/ }).length).toBeGreaterThan(0);
    });

    expect(await screen.findByText("No governance proposals yet.")).toBeInTheDocument();
  });

  it("shows the proposals empty state when the governance module has no proposals", async () => {
    vi.spyOn(api, "getRoles").mockResolvedValue({ ok: true, roles: [ROLE_CEO], edges: [] });
    vi.spyOn(indexer, "fetchTrustModules").mockResolvedValue([
      {
        trustAddress: TRUST_ADDRESS,
        moduleId: indexer.MODULE_ID.governance,
        moduleAddress: "0xmodule",
        moduleAcl: "0x",
        attachedBlock: 50,
      },
    ]);
    vi.spyOn(indexer, "fetchProposalsForModule").mockResolvedValue([]);
    vi.spyOn(indexer, "fetchVotingPower").mockResolvedValue(null);

    renderPage();

    expect(await screen.findByText("No governance proposals yet.")).toBeInTheDocument();
  });

  it("falls back to proposal id when title is absent", async () => {
    const noTitle = { ...PROPOSAL_ACTIVE, title: undefined };
    vi.spyOn(api, "getRoles").mockResolvedValue({ ok: true, roles: [], edges: [] });
    vi.spyOn(indexer, "fetchTrustModules").mockResolvedValue([
      {
        trustAddress: TRUST_ADDRESS,
        moduleId: indexer.MODULE_ID.governance,
        moduleAddress: "0xmodule",
        moduleAcl: "0x",
        attachedBlock: 50,
      },
    ]);
    vi.spyOn(indexer, "fetchProposalsForModule").mockResolvedValue([noTitle]);
    vi.spyOn(indexer, "fetchVotingPower").mockResolvedValue(null);

    renderPage();

    // Should render first 16 chars of proposalId + ellipsis
    expect(await screen.findByText(`${noTitle.proposalId.slice(0, 16)}…`)).toBeInTheDocument();
  });

  it("does not render the proposals section when the entity has no trust address", async () => {
    seedEntity(undefined); // no trust_address
    vi.spyOn(api, "getRoles").mockResolvedValue({ ok: true, roles: [ROLE_CEO], edges: [] });
    const modulesSpy = vi.spyOn(indexer, "fetchTrustModules");

    renderPage();

    // Roles section loads.
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /CEO/ }).length).toBeGreaterThan(0);
    });

    // Proposals section should be absent — no heading, no spinner.
    expect(screen.queryByText("On-chain proposals")).not.toBeInTheDocument();
    // Indexer should not have been called.
    expect(modulesSpy).not.toHaveBeenCalled();
  });
});
