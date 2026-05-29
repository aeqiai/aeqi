import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TrustRolesTab from "@/components/TrustRolesTab";
import TrustRoleDetailPage from "@/components/roles/TrustRoleDetailPage";
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
const edges = [{ parent_role_id: "role-owner", child_role_id: "role-operator" }];

function RoleDetailRouteProbe() {
  const location = useLocation();
  const state =
    location.state && typeof location.state === "object" && "rolesReturnTo" in location.state
      ? (location.state as { rolesReturnTo?: unknown }).rolesReturnTo
      : null;
  return (
    <div>
      <span>Role detail route</span>
      <span data-testid="roles-return-to">{typeof state === "string" ? state : ""}</span>
    </div>
  );
}

function RolesWorkspaceProbe() {
  const location = useLocation();
  return <div>Roles workspace {location.search}</div>;
}

describe("TrustRolesTab", () => {
  beforeEach(() => {
    vi.spyOn(api, "getRoles").mockResolvedValue({ ok: true, roles, edges });
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

  function renderTab(initialEntry = "/trust/root-1/roles") {
    render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/trust/:trustAddress/roles" element={<TrustRolesTab trustId="root-1" />} />
          <Route path="/trust/:trustAddress/roles/:roleId" element={<RoleDetailRouteProbe />} />
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

  it("renders list view as the canonical workspace table and navigates rows to detail", async () => {
    renderTab("/trust/root-1/roles?view=list");

    const workspace = screen.getByLabelText("Role workspace");
    const table = await within(workspace).findByRole("table", { name: "Roles" });
    const tableShell = table.closest(".trust-roles-table");

    expect(tableShell).not.toBeNull();
    expect(table.className).toContain("compact");
    expect(within(table).getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Type" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Occupant" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Reports to" })).toBeInTheDocument();
    expect(
      within(table)
        .getAllByText("Owner")
        .some((node) => node.classList.contains("roles-list-title")),
    ).toBe(true);
    expect(
      within(table)
        .getAllByText("Operator")
        .some((node) => node.classList.contains("roles-list-type")),
    ).toBe(true);
    expect(within(table).getByText("Chief of Staff")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Collapse role panel" })).not.toBeInTheDocument();

    const operatorRow = table.querySelector('[data-row-key="role-operator"]');
    expect(operatorRow).not.toBeNull();
    fireEvent.click(operatorRow!);
    expect(await screen.findByText("Role detail route")).toBeInTheDocument();
    expect(screen.getByTestId("roles-return-to")).toHaveTextContent(
      "/trust/root-1/roles?view=list",
    );
  });

  it("keeps role detail URLs clean while returning to the originating roles workspace", async () => {
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/trust/root-1/roles/role-operator",
            state: { rolesReturnTo: "/trust/root-1/roles?view=list&occupant=agent" },
          },
        ]}
      >
        <Routes>
          <Route path="/trust/:trustAddress/roles" element={<RolesWorkspaceProbe />} />
          <Route
            path="/trust/:trustAddress/roles/:roleId"
            element={<TrustRoleDetailPage trustId="root-1" roleId="role-operator" />}
          />
        </Routes>
      </MemoryRouter>,
    );

    const header = await screen.findByLabelText("Role detail controls");
    expect(
      within(header)
        .getByText("Role")
        .compareDocumentPosition(within(header).getByRole("button", { name: "Roles" })),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(within(header).getByRole("button", { name: "Roles" })).toHaveClass(
      "trust-role-detail-back",
    );

    fireEvent.click(within(header).getByRole("button", { name: "Roles" }));
    expect(
      await screen.findByText("Roles workspace ?view=list&occupant=agent"),
    ).toBeInTheDocument();
  });
});
