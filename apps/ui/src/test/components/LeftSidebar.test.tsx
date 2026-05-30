import { StrictMode } from "react";
import { describe, expect, it, beforeEach } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import LeftSidebar from "@/components/shell/LeftSidebar";
import { agentKeys, entityKeys } from "@/queries/keys";
import { useDaemonStore } from "@/store/daemon";
import { PINNED_VIEWS_STORAGE_KEY, useUIStore } from "@/store/ui";

function withQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const daemonState = useDaemonStore.getState();
  queryClient.setQueryData(entityKeys.all, daemonState.entities);
  queryClient.setQueryData(agentKeys.directory(), daemonState.agents);
  queryClient.setQueryData(["runtime", "status", "root-1"], { has_runtime: true });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

describe("LeftSidebar trust navigation", () => {
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
          type: "trust",
          status: "active",
          created_at: "2026-04-28T00:00:00Z",
        },
      ],
      agents: [{ id: "root-1", name: "Root", status: "active", trust_id: "root-1" }] as never,
      quests: [],
      events: [],
      workerEvents: [],
      wsConnected: false,
      loading: false,
      initialLoaded: true,
    });
  });

  it("shows My sessions as a pinned row and allows multiple trust groups open", () => {
    useUIStore.setState({
      pinnedViews: [
        {
          id: "view-economy",
          label: "Economy board",
          path: "/economy",
          search: "",
          createdAt: "2026-05-30T00:00:00Z",
        },
        {
          id: "view-open-quests",
          label: "Open quests",
          path: "/trust/root-1/quests",
          search: "?status=open",
          createdAt: "2026-05-30T00:00:00Z",
          trustId: "root-1",
        },
      ],
    });

    const { getByRole, getByText, queryByRole, queryByText } = render(
      withQueryClient(
        <StrictMode>
          <MemoryRouter initialEntries={["/trust/root-1"]}>
            <Routes>
              <Route
                path="/trust/:trustId/*"
                element={<LeftSidebar trustId="root-1" path="/trust/root-1" />}
              />
            </Routes>
          </MemoryRouter>
        </StrictMode>,
      ),
    );

    const pinnedView = getByRole("link", { name: "My sessions" });
    expect(pinnedView).toBeInTheDocument();
    expect(pinnedView).toHaveAttribute("href", "/trust/root-1/sessions?view=mine");
    expect(getByRole("button", { name: "Unpin My sessions" })).toBeInTheDocument();
    expect(getByRole("link", { name: "Open quests" })).toHaveAttribute(
      "href",
      "/trust/root-1/quests?status=open",
    );
    expect(getByRole("link", { name: "Economy board" })).toHaveAttribute("href", "/economy");
    expect(getByRole("button", { name: "Unpin Open quests" })).toBeInTheDocument();
    expect(queryByText("Pinned Views")).not.toBeInTheDocument();
    expect(getByText("Trust")).toHaveClass("active");
    expect(queryByRole("link", { name: "Inbox" })).not.toBeInTheDocument();
    expect(queryByRole("link", { name: "Your Inbox" })).not.toBeInTheDocument();
    expect(getByRole("button", { name: "Operations" })).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(getByRole("button", { name: "Ownership" }));

    expect(getByRole("button", { name: "Operations" })).toHaveAttribute("aria-expanded", "true");
    expect(getByRole("button", { name: "Ownership" })).toHaveAttribute("aria-expanded", "true");
    expect(getByRole("link", { name: "Agents" })).toBeInTheDocument();
    expect(getByRole("link", { name: "Shares" })).toBeInTheDocument();
    expect(getByRole("link", { name: "My sessions" })).toBeInTheDocument();
    expect(queryByRole("link", { name: "Inbox" })).not.toBeInTheDocument();

    fireEvent.click(getByRole("button", { name: "Unpin My sessions" }));
    expect(queryByRole("link", { name: "My sessions" })).not.toBeInTheDocument();

    fireEvent.click(getByRole("button", { name: "Unpin Open quests" }));
    expect(queryByRole("link", { name: "Open quests" })).not.toBeInTheDocument();

    fireEvent.click(getByRole("button", { name: "Unpin Economy board" }));
    expect(queryByRole("link", { name: "Economy board" })).not.toBeInTheDocument();
  });
});
