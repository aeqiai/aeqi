import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AgentSurfaceHeader from "@/components/AgentSurfaceHeader";
import { useDaemonStore } from "@/store/daemon";

describe("AgentSurfaceHeader", () => {
  beforeEach(() => {
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
        },
      ] as never,
      quests: [],
      events: [],
      workerEvents: [],
      initialLoaded: true,
    });
  });

  function renderHeader(variant: "default" | "settings" = "default") {
    render(
      <MemoryRouter initialEntries={["/trust/root-1/agents/agent-1"]}>
        <Routes>
          <Route
            path="/trust/:trustAddress/agents/:agentId"
            element={<AgentSurfaceHeader agentId="agent-1" variant={variant} />}
          />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("uses Agents as the back pill and exposes Sessions plus Settings navigation", () => {
    renderHeader();

    expect(screen.getByRole("link", { name: "Agents" })).toHaveAttribute(
      "href",
      "/trust/root-1/agents",
    );
    expect(screen.getByText("Research Agent")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Agent views" });
    const sessions = within(nav).getByRole("link", { name: "Sessions" });
    const settings = within(nav).getByRole("link", { name: "Settings" });
    expect(sessions).toHaveAttribute("href", "/trust/root-1/agents/agent-1");
    expect(sessions).toHaveAttribute("aria-current", "page");
    expect(settings).not.toHaveAttribute("aria-current");
    expect(settings).toHaveAttribute("href", "/trust/root-1/agents/agent-1/settings");
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Sessions" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
  });

  it("keeps the same back pill and marks Settings active on the settings surface", () => {
    renderHeader("settings");

    expect(screen.getByRole("link", { name: "Agents" })).toHaveAttribute(
      "href",
      "/trust/root-1/agents",
    );
    const nav = screen.getByRole("navigation", { name: "Agent views" });
    const sessions = within(nav).getByRole("link", { name: "Sessions" });
    const settings = within(nav).getByRole("link", { name: "Settings" });
    expect(sessions).not.toHaveAttribute("aria-current");
    expect(settings).toHaveAttribute("aria-current", "page");
    expect(settings).toHaveAttribute("href", "/trust/root-1/agents/agent-1/settings");
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New" })).not.toBeInTheDocument();
  });
});
