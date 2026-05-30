import { StrictMode } from "react";
import { describe, expect, it, beforeEach } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import LeftSidebar from "@/components/shell/LeftSidebar";
import { agentKeys, entityKeys } from "@/queries/keys";
import { useDaemonStore } from "@/store/daemon";

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

  it("shows My sessions as a pinned view and keeps one trust group open", () => {
    const { getByRole, queryByRole } = render(
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
    expect(queryByRole("link", { name: "Inbox" })).not.toBeInTheDocument();
    expect(queryByRole("link", { name: "Your Inbox" })).not.toBeInTheDocument();
    expect(getByRole("button", { name: "Operations" })).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(getByRole("button", { name: "Ownership" }));

    expect(getByRole("button", { name: "Ownership" })).toHaveAttribute("aria-expanded", "true");
    expect(getByRole("link", { name: "Shares" })).toBeInTheDocument();
    expect(getByRole("link", { name: "My sessions" })).toBeInTheDocument();
    expect(queryByRole("link", { name: "Inbox" })).not.toBeInTheDocument();
  });
});
