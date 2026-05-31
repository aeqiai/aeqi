import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import CompanyAgentsTab from "@/components/CompanyAgentsTab";
import { api } from "@/lib/api";
import type { AgentTemplate } from "@/lib/types";
import { agentKeys } from "@/queries/keys";
import { useDaemonStore } from "@/store/daemon";

let queryClient: QueryClient;

const STEWARD_TEMPLATE: AgentTemplate = {
  id: "steward",
  name: "Steward",
  tagline: "Maintains operating cadence, context hygiene, and weekly review.",
  role: "Operating Steward",
  seed_events: [
    { owner: "Steward", pattern: "schedule:0 16 * * 5", name: "steward_weekly_review" },
  ],
  seed_ideas: [{ owner: "Steward", name: "Steward operating cadence", tags: ["cadence"] }],
  seed_quests: [{ owner: "Steward", subject: "Run the first Steward review" }],
};

describe("CompanyAgentsTab", () => {
  beforeEach(() => {
    vi.spyOn(api, "getBlueprints").mockResolvedValue({
      ok: true,
      blueprints: [],
      agent_templates: [STEWARD_TEMPLATE],
    });
    vi.spyOn(api, "spawnAgent").mockResolvedValue({
      ok: true,
      agent: {
        id: "research-agent",
        name: "research-agent",
        company_id: "root-1",
        status: "active",
      },
    });
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(agentKeys.directory("root-1"), [
      {
        id: "janus",
        name: "Janus",
        status: "active",
        company_id: "root-1",
        model: "gpt-5",
        created_at: "2026-05-22T00:00:00Z",
        total_tokens: 12400,
        lifetime_cost_usd: 1.25,
        budget_usd: 20,
      },
    ]);
    useDaemonStore.setState({
      entities: [
        {
          id: "root-1",
          name: "Root",
          type: "company",
          status: "active",
          created_at: "2026-05-22T00:00:00Z",
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
      <MemoryRouter initialEntries={["/company/root-1/agents"]}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route
              path="/company/:companyAddress/agents"
              element={<CompanyAgentsTab companyId="root-1" />}
            />
            <Route
              path="/company/:companyAddress/agents/:agentId"
              element={<div>Created agent detail</div>}
            />
            <Route
              path="/templates/:blueprintId/:section"
              element={<div>Agent template detail</div>}
            />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  }

  it("places the search toolbar in the primitive header first row", () => {
    renderTab();

    const heading = screen.getByRole("heading", { name: /Agents/ });
    const header = screen.getByLabelText("Agent controls");
    const search = screen.getByPlaceholderText("Search agents");
    const register = screen.getByRole("region", { name: "Agents register" });

    expect(header).toContainElement(heading);
    expect(header).toHaveAttribute("data-title-variant", "plain");
    expect(screen.queryByRole("link", { name: "Agents" })).not.toBeInTheDocument();
    expect(search.closest(".company-agents-toolbar")).not.toBeNull();
    expect(heading.compareDocumentPosition(search)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(search.compareDocumentPosition(register)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("renders the table and real template suggestion cards directly on the workspace", async () => {
    renderTab();

    const register = screen.getByRole("region", { name: "Agents register" });
    const suggestions = screen.getByRole("region", { name: "Agent templates" });
    const table = screen.getByRole("table", { name: "Agents" });
    const online = within(table).getByText("Online");

    expect(register.closest(".company-agents-register")).not.toBeNull();
    expect(register).toContainElement(table);
    expect(online.closest(".agent-liveness")).toHaveClass("agent-liveness--online");
    expect(suggestions.closest(".company-agents-suggest")).not.toBeNull();
    expect(screen.queryByLabelText("Selected agent")).toBeNull();
    expect(screen.queryByRole("region", { name: "Agent snapshot" })).not.toBeInTheDocument();
    expect(screen.queryByText("Agents register")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1-1 of 1 agents")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.getByText("May 22, 2026")).toBeInTheDocument();
    expect(screen.getByText("Usage")).toBeInTheDocument();
    expect(screen.getByText("$1.25 / $20.00")).toBeInTheDocument();
    expect(screen.getByText("12K tokens")).toBeInTheDocument();
    expect(await screen.findByText("Steward")).toBeInTheDocument();
    expect(screen.getByText("Operating steward · 1 event · 1 idea · 1 quest")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View Steward agent template" })).toBeInTheDocument();
    expect(screen.queryByText("Research Agent")).not.toBeInTheDocument();
    expect(register.compareDocumentPosition(suggestions)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("opens the template detail from an entire suggestion card", async () => {
    renderTab();

    fireEvent.click(await screen.findByRole("button", { name: "View Steward agent template" }));

    expect(screen.getByText("Agent template detail")).toBeInTheDocument();
  });

  it("creates a blank agent from the primary toolbar modal", async () => {
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: /New agent/i }));
    expect(screen.getByRole("dialog", { name: "New agent" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Agent name"), {
      target: { value: "Research Agent" },
    });
    fireEvent.change(screen.getByLabelText("Charter"), {
      target: { value: "Track weekly market changes." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create agent" }));

    await waitFor(() => {
      expect(api.spawnAgent).toHaveBeenCalledWith({
        name: "research-agent",
        company_id: "root-1",
        system_prompt: "You are research-agent. Track weekly market changes.",
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "New agent" })).not.toBeInTheDocument();
    });
    expect(screen.getByText("Created agent detail")).toBeInTheDocument();
    expect(screen.queryByText("Agent template detail")).not.toBeInTheDocument();
  });

  it("validates duplicate agent names in the create modal", async () => {
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: /New agent/i }));
    fireEvent.change(screen.getByLabelText("Agent name"), {
      target: { value: "Janus" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create agent" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "An agent named janus already exists in this COMPANY.",
    );
    expect(api.spawnAgent).not.toHaveBeenCalled();
  });

  it("does not invent suggestions when no agent Templates exist", async () => {
    vi.mocked(api.getBlueprints).mockResolvedValue({
      ok: true,
      blueprints: [],
      agent_templates: [],
    });

    renderTab();

    await waitFor(() => {
      expect(screen.getByText("No agent templates are published yet.")).toBeInTheDocument();
    });
    expect(screen.queryByText("Research Agent")).not.toBeInTheDocument();
    expect(screen.queryByText("Treasury Agent")).not.toBeInTheDocument();
    expect(screen.queryByText("Governance Agent")).not.toBeInTheDocument();
  });
});
