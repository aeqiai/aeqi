import { StrictMode, type ReactElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import AppLayout from "@/components/AppLayout";
import { agentKeys, entityKeys, questKeys, runtimeKeys, activityKeys } from "@/queries/keys";
import { useDaemonStore } from "@/store/daemon";
import type { Trust } from "@/lib/types";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function withQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const daemonState = useDaemonStore.getState();
  queryClient.setQueryData(entityKeys.all, daemonState.entities);
  queryClient.setQueryData(agentKeys.directory(), daemonState.agents);
  queryClient.setQueryData(agentKeys.directory("root-1"), daemonState.agents);
  queryClient.setQueryData(runtimeKeys.cost, daemonState.cost);
  queryClient.setQueryData(questKeys.all, daemonState.quests);
  queryClient.setQueryData(activityKeys.all, daemonState.events);
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

describe("AppLayout drilled-agent hydration", () => {
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
          trust_address: "F9s1sSJRm2CobSLkd1BN1Vj4UigRo9zpZhb6raXsQzPq",
        } as Trust,
      ],
      agents: [],
      quests: [],
      events: [],
      workerEvents: [],
      wsConnected: false,
      loading: false,
      initialLoaded: true,
      agentsLoaded: false,
      fetchAll: vi.fn().mockResolvedValue(undefined) as never,
    });
  });

  it("holds drilled-agent routes on the loader until the directory settles", async () => {
    render(
      withQueryClient(
        <StrictMode>
          <MemoryRouter
            initialEntries={[
              "/trust/F9s1sSJRm2CobSLkd1BN1Vj4UigRo9zpZhb6raXsQzPq/agents/child-1/inbox",
            ]}
          >
            <Routes>
              <Route
                path="/trust/:trustAddress/agents/:agentId/*"
                element={
                  <>
                    <AppLayout />
                    <LocationProbe />
                  </>
                }
              />
            </Routes>
          </MemoryRouter>
        </StrictMode>,
      ),
    );

    expect(screen.getByRole("status", { name: "Loading runtime" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/trust/F9s1sSJRm2CobSLkd1BN1Vj4UigRo9zpZhb6raXsQzPq/agents/child-1/inbox",
      ),
    );
  });
});
