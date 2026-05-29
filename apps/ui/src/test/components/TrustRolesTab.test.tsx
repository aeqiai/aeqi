import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TrustRolesTab from "@/components/TrustRolesTab";
import { api } from "@/lib/api";
import type { Role } from "@/lib/types";
import { useDaemonStore } from "@/store/daemon";

const roles: Role[] = [
  {
    id: "role-owner",
    trust_id: "root-1",
    title: "Owner",
    occupant_kind: "human",
    occupant_id: "user-1",
    role_type: "owner",
    founder: true,
    grants: [],
    created_at: "2026-05-29T00:00:00Z",
  },
  {
    id: "role-operator",
    trust_id: "root-1",
    title: "Operator",
    occupant_kind: "agent",
    occupant_id: "agent-1",
    role_type: "operational",
    founder: false,
    grants: [],
    created_at: "2026-05-29T00:00:00Z",
  },
  {
    id: "role-vacant",
    trust_id: "root-1",
    title: "Designer",
    occupant_kind: "vacant",
    occupant_id: null,
    role_type: "operational",
    founder: false,
    grants: [],
    created_at: "2026-05-29T00:00:00Z",
  },
];

describe("TrustRolesTab", () => {
  beforeEach(() => {
    vi.spyOn(api, "getRoles").mockResolvedValue({ ok: true, roles, edges: [] });
    useDaemonStore.setState({
      entities: [
        {
          id: "root-1",
          name: "Root",
          type: "trust",
          status: "active",
          created_at: "2026-05-29T00:00:00Z",
          trust_address: "root-1",
        },
      ],
      agents: [
        {
          id: "agent-1",
          name: "Chief of Staff",
          status: "active",
          trust_id: "root-1",
        },
      ] as never,
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
      <MemoryRouter initialEntries={["/trust/root-1/roles"]}>
        <Routes>
          <Route path="/trust/:trustAddress/roles" element={<TrustRolesTab trustId="root-1" />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("uses the standardized primitive header count and toolbar controls", async () => {
    renderTab();

    const header = screen.getByLabelText("Role controls");
    const heading = within(header).getByRole("heading", { name: "Roles" });
    const toolbar = header.querySelector(".trust-roles-toolbar");
    const count = header.querySelector(".trust-primitive-page-count");

    expect(header).toHaveAttribute("data-title-variant", "plain");
    expect(toolbar).not.toBeNull();
    await waitFor(() => {
      expect(count).toHaveTextContent("3");
    });
    expect(within(header).getByPlaceholderText("Search roles")).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "Sort: Alphabetical" })).toHaveClass(
      "ideas-toolbar-btn",
    );
    expect(within(header).getByRole("button", { name: "Filter" })).toHaveClass("ideas-toolbar-btn");
    expect(within(header).getByRole("button", { name: "View: Org chart" })).toHaveClass(
      "ideas-toolbar-btn",
    );

    expect(api.getRoles).toHaveBeenCalledWith("root-1");
    const workspace = screen.getByLabelText("Role workspace");
    expect(heading.compareDocumentPosition(workspace)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.queryByText("Authority ramp")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse role panel" })).toHaveClass(
      "role-inspector-icon-action",
    );
  });
});
