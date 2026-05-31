import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import TrustAgentsTab from "@/components/TrustAgentsTab";
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

describe("TrustAgentsTab", () => {
  beforeEach(() => {
    vi.spyOn(api, "getRoles").mockResolvedValue({ ok: true, roles: [], edges: [] });
    vi.spyOn(api, "getBlueprints").mockResolvedValue({
      ok: true,
      blueprints: [],
      agent_templates: [STEWARD_TEMPLATE],
    });
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(agentKeys.directory("root-1"), [
      {
        id: "janus",
        name: "Janus",
        status: "active",
        trust_id: "root-1",
        model: "gpt-5",
        created_at: "2026-05-22T00:00:00Z",
      },
    ]);
    useDaemonStore.setState({
      entities: [
        {
          id: "root-1",
          name: "Root",
          type: "trust",
          status: "active",
          created_at: "2026-05-22T00:00:00Z",
          trust_address: "root-1",
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
      <MemoryRouter initialEntries={["/trust/root-1/agents"]}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route
              path="/trust/:trustAddress/agents"
              element={<TrustAgentsTab trustId="root-1" />}
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
    expect(search.closest(".trust-agents-toolbar")).not.toBeNull();
    expect(heading.compareDocumentPosition(search)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(search.compareDocumentPosition(register)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("renders the table and real template suggestion cards directly on the workspace", async () => {
    renderTab();

    const register = screen.getByRole("region", { name: "Agents register" });
    const suggestions = screen.getByRole("region", { name: "Suggested agents" });
    const table = screen.getByRole("table", { name: "Agents" });
    const online = within(table).getByText("Online");

    expect(register.closest(".trust-agents-register")).not.toBeNull();
    expect(register).toContainElement(table);
    expect(online.closest(".agent-liveness")).toHaveClass("agent-liveness--online");
    expect(suggestions.closest(".trust-agents-suggest")).not.toBeNull();
    expect(screen.queryByLabelText("Selected agent")).toBeNull();
    expect(screen.queryByRole("region", { name: "Agent snapshot" })).not.toBeInTheDocument();
    expect(screen.queryByText("Agents register")).not.toBeInTheDocument();
    expect(await screen.findByText("Steward")).toBeInTheDocument();
    expect(screen.getByText("Operating Steward · 1 event · 1 idea · 1 quest")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Steward from template" })).toBeInTheDocument();
    expect(screen.queryByText("Research Agent")).not.toBeInTheDocument();
    expect(register.compareDocumentPosition(suggestions)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("opens the template picker from an entire suggestion card", async () => {
    renderTab();

    fireEvent.click(await screen.findByRole("button", { name: "Add Steward from template" }));

    expect(screen.getByRole("dialog", { name: "Add agents from a template" })).toBeInTheDocument();
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
