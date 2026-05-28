import { StrictMode, type ReactElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import AppLayout from "@/components/AppLayout";
import AgentSessionContextHeader from "@/components/shell/AgentSessionContextHeader";
import { agentKeys, entityKeys, questKeys, runtimeKeys, activityKeys } from "@/queries/keys";
import { useDaemonStore } from "@/store/daemon";
import { useChatStore } from "@/store/chat";
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
    useChatStore.setState({
      sessionsByAgent: {},
      streamingSessions: {},
      pendingMessageByAgent: {},
      queuedDraftsBySession: {},
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

  it("mounts drilled-agent session context above the rail/detail row", async () => {
    useDaemonStore.setState({
      agents: [
        {
          id: "agent-1",
          name: "Chief of Staff",
          status: "active",
          trust_id: "root-1",
        },
      ] as never,
      agentsLoaded: true,
    });

    const { container } = render(
      withQueryClient(
        <StrictMode>
          <MemoryRouter
            initialEntries={[
              "/trust/F9s1sSJRm2CobSLkd1BN1Vj4UigRo9zpZhb6raXsQzPq/agents/agent-1/inbox",
            ]}
          >
            <Routes>
              <Route path="/trust/:trustAddress/agents/:agentId/:tab" element={<AppLayout />} />
            </Routes>
          </MemoryRouter>
        </StrictMode>,
      ),
    );

    await waitFor(() => {
      const header = container.querySelector(".agent-inbox-shell > .agent-session-context-header");
      const row = container.querySelector(".agent-inbox-shell > .content-body-row");
      expect(header).toBeTruthy();
      expect(row).toBeTruthy();
      expect(header?.nextElementSibling).toBe(row);
    });

    expect(container.querySelectorAll(".asv .session-detail-header")).toHaveLength(0);
  });

  it("renders active session identity and gateway metadata in the context header", () => {
    useDaemonStore.setState({
      agents: [
        {
          id: "agent-1",
          name: "Chief of Staff",
          status: "active",
          trust_id: "root-1",
        },
      ] as never,
      agentsLoaded: true,
    });
    useChatStore.setState({
      sessionsByAgent: {
        "agent-1": [
          {
            id: "session-1",
            agent_id: "agent-1",
            agent_name: "Chief of Staff",
            name: "WhatsApp: Interview prep",
            status: "active",
            created_at: "2026-05-28T08:00:00Z",
            last_active: "2026-05-28T08:01:00Z",
            message_count: 2,
            gateway_transport: "whatsapp",
            gateway_peer_id: "+15550001111",
            gateway_sender_name: "Ada",
            gateway_sender_transport_id: "+15550001111",
          },
        ],
      },
    });

    render(
      <MemoryRouter
        initialEntries={[
          "/trust/F9s1sSJRm2CobSLkd1BN1Vj4UigRo9zpZhb6raXsQzPq/agents/agent-1/inbox/session-1",
        ]}
      >
        <Routes>
          <Route
            path="/trust/:trustAddress/agents/:agentId/:tab/:itemId"
            element={<AgentSessionContextHeader />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Interview prep")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp · Ada · +15550001111")).toBeInTheDocument();
  });
});
