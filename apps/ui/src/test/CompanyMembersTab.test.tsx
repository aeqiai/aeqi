import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CompanyMembersTab from "@/components/CompanyMembersTab";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";

describe("CompanyMembersTab", () => {
  beforeEach(() => {
    vi.spyOn(api, "getUserGrants").mockResolvedValue({ ok: true, grants: [] });
    vi.spyOn(api, "listEntityInvitations").mockResolvedValue({ ok: true, invitations: [] });
    vi.spyOn(api, "getRoles").mockResolvedValue({
      ok: true,
      edges: [],
      roles: [
        {
          id: "role-founder",
          company_id: "root-1",
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
          type: "company",
          status: "active",
          created_at: "2026-05-20T00:00:00Z",
          company_address: "root-1",
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
      <MemoryRouter initialEntries={["/company/root-1/members"]}>
        <Routes>
          <Route
            path="/company/:companyAddress/members"
            element={<CompanyMembersTab companyId="root-1" />}
          />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("renders member status and last active recency for human role occupants", async () => {
    renderTab();

    const table = await screen.findByRole("table", { name: "Company members" });

    expect(within(table).getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Role" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Last active" })).toBeInTheDocument();
    await waitFor(() => {
      expect(within(table).getByText("Ada Founder")).toBeInTheDocument();
      expect(within(table).getByText("Active")).toBeInTheDocument();
      expect(within(table).getByText("Director")).toBeInTheDocument();
      expect(within(table).getByText("now")).toBeInTheDocument();
    });
  });
});
