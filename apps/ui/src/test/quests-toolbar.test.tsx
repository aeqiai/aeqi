import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import AgentQuestsTab from "@/components/AgentQuestsTab";
import type { Quest, QuestStatus, ScopeValue } from "@/lib/types";
import { useDaemonStore } from "@/store/daemon";

function LocationSearchProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

function questFixture(
  id: string,
  name: string,
  status: QuestStatus,
  scope: ScopeValue = "self",
  agentId = "root-1",
): Quest {
  return {
    id,
    idea_id: `idea-${id}`,
    status,
    priority: "normal",
    agent_id: agentId,
    scope,
    cost_usd: 0,
    created_at: "2026-05-16T00:00:00Z",
    updated_at: "2026-05-16T00:00:00Z",
    idea: { id: `idea-${id}`, name, content: "", tags: [] },
  };
}

function renderQuests(initialEntry = "/company/root-1/quests") {
  render(
    <StrictMode>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route
            path="company/:companyAddress/:tab/*"
            element={
              <>
                <AgentQuestsTab agentId="root-1" />
                <LocationSearchProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  );
}

describe("quest toolbar", () => {
  beforeEach(() => {
    useDaemonStore.setState({
      status: null,
      dashboard: null,
      cost: null,
      entities: [],
      agents: [
        {
          id: "root-1",
          name: "Root",
          model: "opus",
          status: "active",
          company_id: "root-1",
        },
      ] as never,
      quests: [],
      events: [],
      workerEvents: [],
      wsConnected: false,
      loading: false,
      initialLoaded: true,
    });
  });

  it("keeps quest search and view mode in the URL", async () => {
    useDaemonStore.setState({
      quests: [
        questFixture("67-review", "Review the quest toolbar", "in_review"),
        questFixture("67-todo", "Write launch copy", "todo"),
      ] as never,
    });

    renderQuests();

    expect(screen.getByRole("button", { name: "View: Board" })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search quests"), {
      target: { value: "review" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("location-search")).toHaveTextContent("q=review");
    });
    expect(screen.getByText("1 match")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sort: Relevance" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "View: Board" }));
    fireEvent.click(screen.getByRole("radio", { name: "List" }));

    await waitFor(() => {
      expect(screen.getByTestId("location-search")).toHaveTextContent("view=list");
      expect(screen.getByTestId("location-search")).toHaveTextContent("q=review");
    });
    expect(screen.getByRole("button", { name: "View: List" })).toBeInTheDocument();
  });

  it("keeps the visibility filter in the URL", async () => {
    useDaemonStore.setState({
      quests: [
        questFixture("67-self", "Role quest", "todo", "self"),
        questFixture("67-global", "COMPANY quest", "todo", "global", undefined),
      ] as never,
    });

    renderQuests("/company/root-1/quests?view=list");

    fireEvent.click(screen.getByTitle("Filter"));
    fireEvent.click(screen.getByRole("radio", { name: /COMPANY/ }));

    await waitFor(() => {
      expect(screen.getByTestId("location-search")).toHaveTextContent("visibility=global");
    });
    expect(screen.queryByText("Role quest")).not.toBeInTheDocument();
    expect(screen.getByText("COMPANY quest")).toBeInTheDocument();
  });

  it("keeps completed quests collapsed until requested", async () => {
    useDaemonStore.setState({
      quests: [
        questFixture("67-todo", "Open work", "todo"),
        questFixture("67-done", "Completed archive item", "done"),
      ] as never,
    });

    renderQuests();

    expect(screen.getByText("Open work")).toBeInTheDocument();
    expect(screen.queryByText("Completed archive item")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Expand column" })[1]);

    expect(screen.getByText("Completed archive item")).toBeInTheDocument();
  });
});
