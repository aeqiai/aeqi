import { StrictMode } from "react";
import { describe, expect, it, beforeEach } from "vitest";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import LeftSidebar from "@/components/shell/LeftSidebar";
import { agentKeys, entityKeys } from "@/queries/keys";
import { useDaemonStore } from "@/store/daemon";
import { PINNED_VIEWS_STORAGE_KEY, useUIStore } from "@/store/ui";

const CANONICAL_NAV_ROWS = new Set([
  "Home",
  "Markets",
  "Templates",
  "Referrals",
  "Launch",
  "Views",
  "Apps",
  "Agents",
  "Sessions",
  "Projects",
  "Goals",
  "Skills",
  "Quests",
  "Ideas",
  "Events",
  "Roles",
  "Members",
  "Controls",
  "Filings",
  "Shares",
  "Rounds",
  "Budgets",
  "Assets",
  "Transactions",
  "Integrations",
  "Gateways",
  "Tools",
  "Runtime",
  "Usage",
  "Billing",
  "Logs",
]);

function withQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const daemonState = useDaemonStore.getState();
  queryClient.setQueryData(entityKeys.all, daemonState.entities);
  queryClient.setQueryData(agentKeys.directory(), daemonState.agents);
  queryClient.setQueryData(["runtime", "status", "root-1"], { has_runtime: true });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

describe("LeftSidebar company navigation", () => {
  beforeEach(() => {
    window.localStorage.removeItem("aeqi_sidebar_pinned_my_sessions");
    window.localStorage.removeItem(PINNED_VIEWS_STORAGE_KEY);
    useUIStore.setState({ pinnedViews: [], sidebarCollapsed: false });
    useDaemonStore.setState({
      status: null,
      dashboard: null,
      cost: null,
      entities: [
        {
          id: "root-1",
          name: "Root",
          type: "company",
          status: "active",
          created_at: "2026-04-28T00:00:00Z",
        },
      ],
      agents: [{ id: "root-1", name: "Root", status: "active", company_id: "root-1" }] as never,
      quests: [],
      events: [],
      workerEvents: [],
      wsConnected: false,
      loading: false,
      initialLoaded: true,
    });
  });

  it("shows My sessions as a pinned row and allows multiple company groups open", async () => {
    useUIStore.setState({
      pinnedViews: [
        {
          id: "view-economy",
          label: "Markets board",
          path: "/markets",
          search: "",
          createdAt: "2026-05-30T00:00:00Z",
        },
        {
          id: "view-open-quests",
          label: "Open quests",
          path: "/company/root-1/quests",
          search: "?status=open",
          createdAt: "2026-05-30T00:00:00Z",
          companyId: "root-1",
        },
      ],
    });

    const { container, findByRole, getByRole, getByText, queryByRole, queryByText } = render(
      withQueryClient(
        <StrictMode>
          <MemoryRouter initialEntries={["/company/root-1"]}>
            <Routes>
              <Route
                path="/company/:companyId/*"
                element={<LeftSidebar companyId="root-1" path="/company/root-1" />}
              />
            </Routes>
          </MemoryRouter>
        </StrictMode>,
      ),
    );

    const pinnedView = await findByRole("link", { name: "My sessions" });
    expect(pinnedView).toBeInTheDocument();
    expect(pinnedView).toHaveAttribute("href", "/company/root-1/sessions?view=mine");
    await waitFor(() => {
      expect(
        useUIStore
          .getState()
          .pinnedViews.some(
            (view) =>
              view.label === "My sessions" &&
              view.path === "/company/root-1/sessions" &&
              view.search === "?view=mine" &&
              view.companyId === "root-1",
          ),
      ).toBe(true);
    });
    expect(getByRole("button", { name: "Unpin My sessions" })).toBeInTheDocument();
    expect(getByRole("link", { name: "Open quests" })).toHaveAttribute(
      "href",
      "/company/root-1/quests?status=open",
    );
    expect(getByRole("link", { name: "Markets board" })).toHaveAttribute("href", "/markets");
    expect(getByRole("button", { name: "Unpin Open quests" })).toBeInTheDocument();
    expect(queryByText("Pinned Views")).not.toBeInTheDocument();
    expect(getByText("Company")).toHaveClass("active");
    expect(queryByRole("link", { name: "Inbox" })).not.toBeInTheDocument();
    expect(queryByRole("link", { name: "Your Inbox" })).not.toBeInTheDocument();
    expect(getByRole("button", { name: "Operations" })).toHaveAttribute("aria-expanded", "true");
    expect(getByRole("link", { name: "Apps" })).toHaveAttribute("href", "/company/root-1/apps");
    const operations = getByRole("region", { name: "Operations" });
    expect(within(operations).getByRole("link", { name: "Projects" })).toBeInTheDocument();
    expect(within(operations).getByRole("link", { name: "Goals" })).toBeInTheDocument();
    expect(within(operations).getByRole("link", { name: "Skills" })).toBeInTheDocument();
    expect(within(operations).queryByRole("link", { name: "Apps" })).not.toBeInTheDocument();
    expect(queryByRole("button", { name: "Capabilities" })).not.toBeInTheDocument();

    fireEvent.click(getByRole("button", { name: "Ownership" }));
    fireEvent.click(getByRole("button", { name: "Infrastructure" }));

    expect(getByRole("button", { name: "Operations" })).toHaveAttribute("aria-expanded", "true");
    expect(getByRole("button", { name: "Ownership" })).toHaveAttribute("aria-expanded", "true");
    expect(getByRole("button", { name: "Infrastructure" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(getByRole("link", { name: "Agents" })).toBeInTheDocument();
    const ownership = getByRole("region", { name: "Ownership" });
    expect(within(ownership).getByRole("link", { name: "Controls" })).toHaveAttribute(
      "href",
      "/company/root-1/controls",
    );
    expect(within(ownership).getByRole("link", { name: "Filings" })).toHaveAttribute(
      "href",
      "/company/root-1/filings",
    );
    const infrastructure = getByRole("region", { name: "Infrastructure" });
    expect(within(infrastructure).getByRole("link", { name: "Runtime" })).toHaveAttribute(
      "href",
      "/company/root-1/runtime",
    );
    expect(within(infrastructure).getByRole("link", { name: "Usage" })).toHaveAttribute(
      "href",
      "/company/root-1/usage",
    );
    expect(within(infrastructure).getByRole("link", { name: "Billing" })).toHaveAttribute(
      "href",
      "/company/root-1/billing",
    );
    expect(getByRole("link", { name: "Shares" })).toBeInTheDocument();
    expect(getByRole("link", { name: "Logs" })).toHaveAttribute("href", "/company/root-1/logs");
    expect(queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
    expect(getByRole("link", { name: "My sessions" })).toBeInTheDocument();
    expect(queryByRole("link", { name: "Inbox" })).not.toBeInTheDocument();

    const canonicalIconRows = [...container.querySelectorAll(".sidebar-nav-item")]
      .map((row) => {
        const label = row.querySelector(".sidebar-nav-label")?.textContent?.trim();
        const icon = [...(row.querySelector("svg")?.classList ?? [])].find(
          (className) => className.startsWith("lucide-") && className !== "lucide-icon",
        );
        return label && CANONICAL_NAV_ROWS.has(label) ? [label, icon] : null;
      })
      .filter((row): row is [string, string] => Boolean(row?.[1]));
    const icons = canonicalIconRows.map(([, icon]) => icon);
    expect(new Set(icons).size).toBe(icons.length);

    fireEvent.click(getByRole("button", { name: "Unpin My sessions" }));
    expect(queryByRole("link", { name: "My sessions" })).not.toBeInTheDocument();
    expect(window.localStorage.getItem("aeqi_sidebar_pinned_my_sessions")).toBe("false");

    fireEvent.click(getByRole("button", { name: "Unpin Open quests" }));
    expect(queryByRole("link", { name: "Open quests" })).not.toBeInTheDocument();

    fireEvent.click(getByRole("button", { name: "Unpin Markets board" }));
    expect(queryByRole("link", { name: "Markets board" })).not.toBeInTheDocument();
  });
});
