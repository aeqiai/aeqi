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
          type: "company",
          status: "active",
          created_at: "2026-05-23T00:00:00Z",
          company_address: "root-1",
        },
      ],
      agents: [
        {
          id: "agent-1",
          name: "Research Agent",
          status: "active",
          company_id: "root-1",
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
      <MemoryRouter initialEntries={["/company/root-1/agents/agent-1"]}>
        <Routes>
          <Route
            path="/company/:companyAddress/agents/:agentId"
            element={<AgentSurfaceHeader agentId="agent-1" variant={variant} />}
          />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("uses Agents as the back pill and keeps the header free of view navigation", () => {
    renderHeader();

    expect(screen.getByRole("link", { name: "Agents" })).toHaveAttribute(
      "href",
      "/company/root-1/agents",
    );
    expect(screen.getByText("Research Agent")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Agent views" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Sessions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New" })).not.toBeInTheDocument();
  });

  it("keeps the same simple header on the settings surface", () => {
    renderHeader("settings");

    expect(screen.getByRole("link", { name: "Agents" })).toHaveAttribute(
      "href",
      "/company/root-1/agents",
    );
    expect(screen.getByText("Research Agent")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Agent views" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New" })).not.toBeInTheDocument();
  });
});
