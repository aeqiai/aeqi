import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import AgentEventsTab from "@/components/AgentEventsTab";
import * as eventsApi from "@/api/events";
import { useDaemonStore } from "@/store/daemon";
import type { Agent, AgentEvent, Company } from "@/lib/types";

vi.mock("@/api/events", () => ({
  listAgentEvents: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
}));

const COMPANY: Company = {
  id: "company-1",
  name: "Runtime",
  type: "company",
  status: "active",
  created_at: "2026-05-01T00:00:00Z",
  company_address: "0xabc",
};

const AGENTS: Agent[] = [
  {
    id: "agent-1",
    name: "Janus",
    company_id: COMPANY.id,
    status: "active",
  },
  {
    id: "agent-2",
    name: "Operator",
    company_id: COMPANY.id,
    status: "idle",
  },
];

function eventFor(agentId: string, name: string): AgentEvent {
  return {
    id: `${agentId}-event`,
    agent_id: agentId,
    name,
    pattern: "session:start",
    tool_calls: [{ tool: "ideas.search", args: {} }],
    enabled: true,
    cooldown_secs: 0,
    fire_count: 0,
    total_cost_usd: 0,
    system: false,
  };
}

const initialDaemonState = useDaemonStore.getState();

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderEvents(initialEntry = "/company/0xabc/events") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route
            path="/company/:companyAddress/events"
            element={
              <>
                <AgentEventsTab agentId="agent-1" agentRail />
                <LocationProbe />
              </>
            }
          />
          <Route
            path="/company/:companyAddress/events/:itemId"
            element={
              <>
                <AgentEventsTab agentId="agent-1" agentRail />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AgentEventsTab agent filter", () => {
  beforeEach(() => {
    localStorage.clear();
    useDaemonStore.setState({
      ...initialDaemonState,
      entities: [COMPANY],
      agents: AGENTS,
    });
    vi.mocked(eventsApi.listAgentEvents).mockImplementation(async (agentId: string) => ({
      events:
        agentId === "agent-2"
          ? [eventFor("agent-2", "Operator loop check")]
          : [eventFor("agent-1", "Session birth context")],
    }));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    useDaemonStore.setState(initialDaemonState, true);
  });

  it("uses the query-string agent as the active event lens", async () => {
    renderEvents("/company/0xabc/events?agent=agent-2");

    expect(await screen.findByText("Operator loop check")).toBeInTheDocument();
    expect(eventsApi.listAgentEvents).toHaveBeenCalledWith("agent-2");

    expect(
      screen.queryByRole("complementary", { name: "Event agent lens" }),
    ).not.toBeInTheDocument();

    const agentFilter = screen.getByRole("button", { name: "Agent: Operator" });
    fireEvent.click(agentFilter);

    expect(screen.getByRole("radio", { name: "Janus" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Operator" })).toBeInTheDocument();
  });

  it("switches the selected agent without leaving the Events page", async () => {
    renderEvents("/company/0xabc/events?agent=agent-2");
    expect(await screen.findByText("Operator loop check")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Agent: Operator" }));
    fireEvent.click(screen.getByRole("radio", { name: "Janus" }));

    await waitFor(() => expect(eventsApi.listAgentEvents).toHaveBeenCalledWith("agent-1"));
    expect(await screen.findByText("Session birth context")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/company/0xabc/events?agent=agent-1");
  });

  it("keeps creation focused on runtime loop handlers", async () => {
    renderEvents("/company/0xabc/events");
    expect(await screen.findByText("Session birth context")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "New handler" }));

    expect(screen.getByText("Add to Janus loop")).toBeInTheDocument();
    expect(screen.getByText("session · lifecycle")).toBeInTheDocument();
    expect(screen.getByText("context · budget")).toBeInTheDocument();
    expect(screen.queryByText("webhook · external http")).not.toBeInTheDocument();
    expect(screen.queryByText("telegram · chat")).not.toBeInTheDocument();
  });
});
