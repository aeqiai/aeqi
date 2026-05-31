import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CompanyRolesTab from "@/components/CompanyRolesTab";
import CompanyRoleDetailPage from "@/components/roles/CompanyRoleDetailPage";
import { api } from "@/lib/api";
import type { Role } from "@/lib/types";
import { useDaemonStore } from "@/store/daemon";

const roles: Role[] = [
  {
    id: "role-owner",
    company_id: "root-1",
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
    company_id: "root-1",
    title: "Operator",
    occupant_kind: "agent",
    occupant_id: "agent-1",
    description_idea_id: "idea-role-operator",
    role_type: "operational",
    founder: false,
    grants: [],
    created_at: "2026-05-29T00:00:00Z",
  },
  {
    id: "role-vacant",
    company_id: "root-1",
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

describe("CompanyRolesTab", () => {
  beforeEach(() => {
    vi.spyOn(api, "getRoles").mockResolvedValue({ ok: true, roles, edges });
    vi.spyOn(api, "getIdeasByIds").mockResolvedValue({
      ok: true,
      ideas: [
        {
          id: "idea-role-operator",
          name: "Operator",
          content: "",
          tags: ["role"],
          scope: "global",
        },
      ],
    });
    useDaemonStore.setState({
      entities: [
        {
          id: "root-1",
          name: "Root",
          type: "company",
          status: "active",
          created_at: "2026-05-29T00:00:00Z",
          company_address: "root-1",
        },
      ],
      agents: [
        {
          id: "agent-1",
          name: "Chief of Staff",
          status: "active",
          company_id: "root-1",
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

  function renderTab(initialEntry = "/company/root-1/roles") {
    render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route
            path="/company/:companyAddress/roles"
            element={<CompanyRolesTab companyId="root-1" />}
          />
          <Route path="/company/:companyAddress/roles/:roleId" element={<RoleDetailRouteProbe />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("uses the standardized primitive header count and toolbar controls", async () => {
    renderTab();

    const header = screen.getByLabelText("Role controls");
    const heading = within(header).getByRole("heading", { name: "Roles" });
    const toolbar = header.querySelector(".company-roles-toolbar");
    const count = header.querySelector(".company-primitive-page-count");

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
    expect(within(header).getByRole("button", { name: "Pin current view" })).toBeInTheDocument();
    expect(
      within(header).queryByRole("button", { name: "Copy roles route" }),
    ).not.toBeInTheDocument();

    expect(api.getRoles).toHaveBeenCalledWith("root-1");
    const workspace = screen.getByLabelText("Role workspace");
    expect(heading.compareDocumentPosition(workspace)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.queryByText("Authority ramp")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Collapse role panel" })).not.toBeInTheDocument();
  });

  it("renders list view as the canonical workspace table and navigates rows to detail", async () => {
    renderTab("/company/root-1/roles?view=list");

    const workspace = screen.getByLabelText("Role workspace");
    const table = await within(workspace).findByRole("table", { name: "Roles" });
    const tableShell = table.closest(".company-roles-table");

    expect(tableShell).not.toBeNull();
    expect(table.className).toContain("compact");
    expect(within(table).getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Type" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Occupant" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Reports to" })).toBeInTheDocument();
    expect(within(table).getByText("Showing 1-3 of 3 roles")).toBeInTheDocument();
    expect(
      Array.from(table.querySelectorAll("tbody tr")).map((row) => row.getAttribute("data-row-key")),
    ).toEqual(["role-vacant", "role-operator", "role-owner"]);
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
      "/company/root-1/roles?view=list",
    );
  });

  it("keeps role detail URLs clean while returning to the originating roles workspace", async () => {
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/company/root-1/roles/role-operator",
            state: { rolesReturnTo: "/company/root-1/roles?view=list&occupant=agent" },
          },
        ]}
      >
        <Routes>
          <Route path="/company/:companyAddress/roles" element={<RolesWorkspaceProbe />} />
          <Route
            path="/company/:companyAddress/roles/:roleId"
            element={<CompanyRoleDetailPage companyId="root-1" roleId="role-operator" />}
          />
        </Routes>
      </MemoryRouter>,
    );

    const header = await screen.findByLabelText("Role detail controls");
    expect(within(header).getByRole("button", { name: "Roles" })).toHaveClass(
      "company-role-detail-back",
    );
    expect(within(header).queryByText("Role")).not.toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "Copy role route" })).toBeInTheDocument();

    fireEvent.click(within(header).getByRole("button", { name: "Roles" }));
    expect(
      await screen.findByText("Roles workspace ?view=list&occupant=agent"),
    ).toBeInTheDocument();
  });
});
