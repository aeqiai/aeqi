import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

  it("uses Agents as the back pill and exposes Sessions plus Settings modes", () => {
    renderHeader();

    expect(screen.getByRole("link", { name: "Agents" })).toHaveAttribute(
      "href",
      "/trust/root-1/agents",
    );
    expect(screen.getByText("Research Agent")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Sessions" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Settings" })).toHaveAttribute(
      "href",
      "/trust/root-1/agents/agent-1/settings",
    );
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
  });

  it("keeps the same back pill and marks Settings active on the settings surface", () => {
    renderHeader("settings");

    expect(screen.getByRole("link", { name: "Agents" })).toHaveAttribute(
      "href",
      "/trust/root-1/agents",
    );
    expect(screen.getByRole("tab", { name: "Settings" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("button", { name: "New" })).not.toBeInTheDocument();
  });
});
