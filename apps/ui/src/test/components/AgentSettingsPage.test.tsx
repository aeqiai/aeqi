import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AgentSettingsPage from "@/pages/AgentSettingsPage";
import { api } from "@/lib/api";
import { ALL_TOOLS } from "@/lib/tools";
import { useDaemonStore } from "@/store/daemon";

describe("AgentSettingsPage", () => {
  beforeEach(() => {
    vi.spyOn(api, "getModels").mockResolvedValue({
      ok: true,
      models: [
        {
          id: "anthropic/claude-sonnet-4.6",
          display_name: "Claude Sonnet 4.6",
          family: "anthropic",
          tier: "balanced",
          context_window: 200000,
          price_in: 3,
          price_out: 15,
          notes: "",
          recommended: true,
          tags: [],
        },
      ],
    });
    useDaemonStore.setState({
      entities: [
        {
          id: "root-1",
          name: "Root",
          type: "trust",
          status: "active",
          created_at: "2026-05-23T00:00:00Z",
          trust_address: "root-1",
        },
      ],
      agents: [
        {
          id: "agent-1",
          name: "Research Agent",
          status: "active",
          trust_id: "root-1",
          model: "anthropic/claude-sonnet-4.6",
          tool_deny: ["shell"],
          can_ask_director: true,
        },
      ] as never,
      quests: [],
      events: [],
      workerEvents: [],
      initialLoaded: true,
    });
  });

  it("renders only model and tools settings for the agent", async () => {
    render(
      <MemoryRouter initialEntries={["/trust/root-1/agents/agent-1/settings"]}>
        <Routes>
          <Route
            path="/trust/:trustAddress/agents/:agentId/settings"
            element={<AgentSettingsPage agentId="agent-1" />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Model" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tools" })).toBeInTheDocument();
    expect((await screen.findAllByText("Claude Sonnet 4.6")).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { pressed: true }).length).toBe(ALL_TOOLS.length - 1);
    expect(screen.getByRole("button", { name: /Shell/i })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("Danger zone")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Overview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Integrations" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Agent views" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Settings" })).not.toBeInTheDocument();
  });
});
