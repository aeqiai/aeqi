import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import TrustAgentsTab from "@/components/TrustAgentsTab";
import { api } from "@/lib/api";
import { agentKeys } from "@/queries/keys";
import { useDaemonStore } from "@/store/daemon";

let queryClient: QueryClient;

describe("TrustAgentsTab", () => {
  beforeEach(() => {
    vi.spyOn(api, "getRoles").mockResolvedValue({ ok: true, roles: [], edges: [] });
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

  it("renders the table and suggestion cards directly on the workspace", () => {
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
    expect(screen.getAllByRole("button", { name: /^Add .* Agent$/ })).toHaveLength(3);
    expect(register.compareDocumentPosition(suggestions)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("opens the blueprint picker from an entire suggestion card", () => {
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: "Add Research Agent" }));

    expect(screen.getByRole("dialog", { name: "Add agents from a Blueprint" })).toBeInTheDocument();
  });
});
