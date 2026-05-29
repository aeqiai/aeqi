import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TrustMembersTab from "@/components/TrustMembersTab";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";

describe("TrustMembersTab", () => {
  beforeEach(() => {
    vi.spyOn(api, "getUserGrants").mockResolvedValue({ ok: true, grants: [] });
    vi.spyOn(api, "listEntityInvitations").mockResolvedValue({ ok: true, invitations: [] });
    vi.spyOn(api, "getRoles").mockResolvedValue({
      ok: true,
      edges: [],
      roles: [
        {
          id: "role-founder",
          trust_id: "root-1",
          title: "Founder",
          occupant_kind: "human",
          occupant_id: "user-1",
          occupant_name: "Ada Founder",
          occupant_avatar_url: null,
          occupant_last_active: new Date().toISOString(),
          role_type: "director",
          founder: true,
          grants: ["*"],
          created_at: "2026-05-20T00:00:00Z",
        },
      ],
    });
    useAuthStore.setState({
      user: {
        id: "user-1",
        email: "ada@example.com",
        name: "Ada Founder",
        roots: ["root-1"],
        entities: ["root-1"],
      },
    } as never);
    useDaemonStore.setState({
      entities: [
        {
          id: "root-1",
          name: "Root",
          type: "trust",
          status: "active",
          created_at: "2026-05-20T00:00:00Z",
          trust_address: "root-1",
        },
      ],
      agents: [],
      quests: [],
      events: [],
      workerEvents: [],
      initialLoaded: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderTab() {
    render(
      <MemoryRouter initialEntries={["/trust/root-1/members"]}>
        <Routes>
          <Route
            path="/trust/:trustAddress/members"
            element={<TrustMembersTab trustId="root-1" />}
          />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("renders member state and last active recency for human role occupants", async () => {
    renderTab();

    const table = await screen.findByRole("table", { name: "Trust members" });

    expect(within(table).getByRole("columnheader", { name: "State" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Last active" })).toBeInTheDocument();
    await waitFor(() => {
      expect(within(table).getByText("Ada Founder")).toBeInTheDocument();
      expect(within(table).getAllByText("Member").length).toBeGreaterThan(1);
      expect(within(table).getByText("now")).toBeInTheDocument();
    });
  });
});
