import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import AgentQuestsTab from "@/components/AgentQuestsTab";
import AppLayout, { resolveDefaultAgent } from "@/components/AppLayout";
import LeftSidebar from "@/components/shell/LeftSidebar";
import ComposerRow from "@/components/shell/ComposerRow";
import BootLoader from "@/components/shell/BootLoader";
import AgentOrgChart from "@/components/AgentOrgChart";
import ShortcutsOverlay from "@/components/ShortcutsOverlay";
import { agentKeys, entityKeys, runtimeKeys } from "@/queries/keys";
import { api } from "@/lib/api";
import type { Quest, QuestStatus, ScopeValue } from "@/lib/types";
import { useDaemonStore } from "@/store/daemon";
import { useUIStore } from "@/store/ui";

/**
 * Smoke tests that catch runtime rendering bugs before they reach production.
 *
 * The primary target is React error #185 ("Maximum update depth exceeded"),
 * which fires at render time when a component returns a fresh reference
 * (array/object) from a state-management selector on every call. StrictMode
 * amplifies these by double-invoking, so a clean render here is strong
 * evidence the component is loop-free.
 *
 * We render each component under StrictMode + MemoryRouter with realistic
 * URL shapes and watch for React's "error" console output during render.
 *
 * Canonical routes: `/trust/:trustAddress/[:tab[/:itemId]]`. The entity-
 * root agent renders at `/trust/:trustAddress/...`; per-agent drilldowns
 * live at `/trust/:trustAddress/agents/:agentId/...`.
 */

/** Inline helper — renders the component tree, returns any errors React logged. */
function captureRenderErrors(ui: React.ReactElement): unknown[] {
  const errors: unknown[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
    errors.push(args);
  });
  try {
    render(ui);
    return errors;
  } finally {
    spy.mockRestore();
  }
}

function withQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const daemonState = useDaemonStore.getState();
  queryClient.setQueryData(entityKeys.all, daemonState.entities);
  queryClient.setQueryData(agentKeys.directory, daemonState.agents);
  queryClient.setQueryData(runtimeKeys.cost, daemonState.cost);
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

function isLoopError(e: unknown): boolean {
  const s = Array.isArray(e) ? e.join(" ") : String(e);
  return /Maximum update depth|Minified React error #185|infinite loop/.test(s);
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
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

function ShellUnderTest() {
  return (
    <>
      <AppLayout />
      <LocationProbe />
    </>
  );
}

describe("AgentQuestsTab smoke", () => {
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
          trust_id: "root-1",
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

  it("renders the board view without throwing when no quest is selected", () => {
    expect(() =>
      render(
        <StrictMode>
          <MemoryRouter initialEntries={["/trust/root-1/quests"]}>
            <Routes>
              <Route
                path="trust/:trustAddress/:tab/*"
                element={<AgentQuestsTab agentId="root-1" />}
              />
            </Routes>
          </MemoryRouter>
        </StrictMode>,
      ),
    ).not.toThrow();
  });

  it("exposes a New quest button on the empty board", () => {
    const { container } = render(
      <StrictMode>
        <MemoryRouter initialEntries={["/trust/root-1/quests"]}>
          <Routes>
            <Route
              path="trust/:trustAddress/:tab/*"
              element={<AgentQuestsTab agentId="root-1" />}
            />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );
    // The always-on compose strip is gone; creation now lives behind
    // the labeled primary toolbar button (title attribute identifies
    // it; visible label is just "New") which opens NewQuestModal.
    const trigger = container.querySelector('button[title^="New quest"]');
    expect(trigger).not.toBeNull();
  });

  it("entity scope keeps sibling-agent quests visible", () => {
    useDaemonStore.setState({
      quests: [
        {
          id: "67-root",
          idea_id: "idea-root",
          status: "todo",
          priority: "normal",
          agent_id: "root-1",
          scope: "self",
          created_at: "2026-05-16T00:00:00Z",
          idea: { id: "idea-root", name: "Root quest", content: "", tags: [] },
        },
        {
          id: "67-child",
          idea_id: "idea-child",
          status: "todo",
          priority: "normal",
          agent_id: "child-1",
          scope: "self",
          created_at: "2026-05-16T00:00:00Z",
          idea: { id: "idea-child", name: "Child quest", content: "", tags: [] },
        },
      ] as never,
    });

    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/trust/root-1/quests"]}>
          <Routes>
            <Route
              path="trust/:trustAddress/:tab/*"
              element={<AgentQuestsTab agentId="root-1" scope="entity" />}
            />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );

    expect(screen.getByText("Root quest")).toBeInTheDocument();
    expect(screen.getByText("Child quest")).toBeInTheDocument();
  });

  it("scopes the board into a quest's direct children", () => {
    useDaemonStore.setState({
      quests: [
        {
          id: "67-root",
          idea_id: "idea-root",
          status: "todo",
          priority: "normal",
          agent_id: "root-1",
          scope: "self",
          created_at: "2026-05-16T00:00:00Z",
          idea: { id: "idea-root", name: "Root quest", content: "", tags: [] },
        },
        {
          id: "67-root.1",
          idea_id: "idea-child",
          status: "todo",
          priority: "normal",
          agent_id: "root-1",
          scope: "self",
          created_at: "2026-05-16T00:00:00Z",
          idea: { id: "idea-child", name: "Child quest", content: "", tags: [] },
        },
      ] as never,
    });

    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/trust/root-1/quests"]}>
          <Routes>
            <Route
              path="trust/:trustAddress/:tab/*"
              element={<AgentQuestsTab agentId="root-1" />}
            />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );

    expect(screen.getByRole("button", { name: /Open board for Root quest/ })).toBeInTheDocument();
    expect(screen.queryByText("Child quest")).not.toBeInTheDocument();
    expect(
      screen.getByText("Drop a quest here to scope the board to its children"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Open board for Root quest/ }));

    expect(screen.getByText("Child quest")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New subquest/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Clear scope/ })).toBeInTheDocument();
    expect(screen.getByText("Scope")).toBeInTheDocument();
  });

  it("list view keeps Backlog and In review visible", () => {
    useDaemonStore.setState({
      quests: [
        questFixture("67-backlog", "Backlog quest", "backlog"),
        questFixture("67-review", "Review quest", "in_review"),
        questFixture("67-todo", "Todo quest", "todo"),
      ] as never,
    });

    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/trust/root-1/quests?view=list"]}>
          <Routes>
            <Route
              path="trust/:trustAddress/:tab/*"
              element={<AgentQuestsTab agentId="root-1" />}
            />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );

    expect(screen.getAllByText("Backlog").length).toBeGreaterThan(0);
    expect(screen.getByText("Backlog quest")).toBeInTheDocument();
    expect(screen.getAllByText("In review").length).toBeGreaterThan(0);
    expect(screen.getByText("Review quest")).toBeInTheDocument();
  });

  it("scope status toggles collapse matching list groups", () => {
    useDaemonStore.setState({
      quests: [
        questFixture("67-review", "Review quest", "in_review"),
        questFixture("67-done", "Done quest", "done"),
      ] as never,
    });

    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/trust/root-1/quests?view=list"]}>
          <Routes>
            <Route
              path="trust/:trustAddress/:tab/*"
              element={<AgentQuestsTab agentId="root-1" />}
            />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );

    expect(screen.getByText("Review quest")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Hide In review column/ }));

    expect(screen.queryByText("Review quest")).not.toBeInTheDocument();
    expect(screen.getByText("Done quest")).toBeInTheDocument();
  });

  it("visibility scope filter applies in list view", () => {
    useDaemonStore.setState({
      quests: [
        questFixture("67-self", "Role quest", "todo", "self"),
        questFixture("67-global", "TRUST quest", "todo", "global", undefined),
      ] as never,
    });

    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/trust/root-1/quests?view=list"]}>
          <Routes>
            <Route
              path="trust/:trustAddress/:tab/*"
              element={<AgentQuestsTab agentId="root-1" />}
            />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );

    expect(screen.getByText("Role quest")).toBeInTheDocument();
    expect(screen.getByText("TRUST quest")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Filter"));
    fireEvent.click(screen.getByRole("radio", { name: /TRUST/ }));

    expect(screen.queryByText("Role quest")).not.toBeInTheDocument();
    expect(screen.getByText("TRUST quest")).toBeInTheDocument();
  });

  it("does not log a React error during render", () => {
    const errors = captureRenderErrors(
      <StrictMode>
        <MemoryRouter initialEntries={["/trust/root-1/quests"]}>
          <Routes>
            <Route
              path="trust/:trustAddress/:tab/*"
              element={<AgentQuestsTab agentId="root-1" />}
            />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );
    expect(errors.find(isLoopError)).toBeUndefined();
  });
});

describe("shell components smoke", () => {
  beforeEach(() => {
    localStorage.setItem("aeqi_entity", "root-1");
    useUIStore.setState({ activeEntity: "root-1" });
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
        },
      ],
      agents: [{ id: "root-1", name: "Root", status: "active", trust_id: "root-1" }] as never,
      quests: [],
      events: [],
      workerEvents: [],
      wsConnected: false,
      loading: false,
      initialLoaded: true,
    });
  });

  it("keeps / at user scope even when a company is active", async () => {
    render(
      withQueryClient(
        <StrictMode>
          <MemoryRouter initialEntries={["/"]}>
            <Routes>
              <Route index element={<ShellUnderTest />} />
              <Route path="c/:trustId" element={<ShellUnderTest />} />
              <Route path="c/:trustId/:tab" element={<ShellUnderTest />} />
              <Route path="c/:trustId/:tab/:itemId" element={<ShellUnderTest />} />
            </Routes>
          </MemoryRouter>
        </StrictMode>,
      ),
    );

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/"));
  });

  it("BootLoader renders the splash", () => {
    const errors = captureRenderErrors(
      <StrictMode>
        <BootLoader />
      </StrictMode>,
    );
    expect(errors.find(isLoopError)).toBeUndefined();
  });

  it("LeftSidebar renders at the root scope", () => {
    const errors = captureRenderErrors(
      withQueryClient(
        <StrictMode>
          <MemoryRouter initialEntries={["/trust/root-1"]}>
            <Routes>
              <Route
                path="c/:trustId/*"
                element={<LeftSidebar trustId="root-1" path="/trust/root-1" />}
              />
            </Routes>
          </MemoryRouter>
        </StrictMode>,
      ),
    );
    expect(errors.find(isLoopError)).toBeUndefined();
  });

  it("LeftSidebar renders with a drilled-in child agent", () => {
    const errors = captureRenderErrors(
      withQueryClient(
        <StrictMode>
          <MemoryRouter initialEntries={["/trust/root-1/agents/child-1/inbox"]}>
            <Routes>
              <Route
                path="c/:trustId/*"
                element={<LeftSidebar trustId="root-1" path="/trust/root-1/agents/child-1/inbox" />}
              />
            </Routes>
          </MemoryRouter>
        </StrictMode>,
      ),
    );
    expect(errors.find(isLoopError)).toBeUndefined();
  });

  it("ComposerRow renders without a mounted chat (pending-message path)", () => {
    const errors = captureRenderErrors(
      <StrictMode>
        <MemoryRouter initialEntries={["/trust/root-1"]}>
          <Routes>
            <Route
              path="c/:trustId/*"
              element={<ComposerRow agentId={null} base="/trust/root-1" sessionsMounted={false} />}
            />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );
    expect(errors.find(isLoopError)).toBeUndefined();
  });

  it("ComposerRow renders with a mounted chat (event-bridge path)", () => {
    const errors = captureRenderErrors(
      <StrictMode>
        <MemoryRouter initialEntries={["/trust/root-1/inbox"]}>
          <Routes>
            <Route
              path="c/:trustId/*"
              element={<ComposerRow agentId="root-1" base="/trust/root-1" sessionsMounted={true} />}
            />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );
    expect(errors.find(isLoopError)).toBeUndefined();
  });

  it("resolves the entity's default agent from the platform placement agent id", () => {
    const resolved = resolveDefaultAgent(
      [
        {
          id: "agent-default",
          name: "Default",
          status: "active",
          trust_id: "runtime-local-entity",
        },
      ],
      { agent_id: "agent-default" },
      "platform-entity",
    );

    expect(resolved?.id).toBe("agent-default");
  });

  it("falls back to the legacy agent trust_id match", () => {
    const resolved = resolveDefaultAgent(
      [
        {
          id: "legacy-default",
          name: "Default",
          status: "active",
          trust_id: "platform-entity",
        },
      ],
      null,
      "platform-entity",
    );

    expect(resolved?.id).toBe("legacy-default");
  });
});

describe("AgentOrgChart smoke", () => {
  beforeEach(() => {
    vi.spyOn(api, "getRoles").mockImplementation(() => new Promise(() => {}));
    useDaemonStore.setState({
      entities: [],
      agents: [],
      quests: [],
      events: [],
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when the parent is not in the store", () => {
    const { container } = render(
      <StrictMode>
        <MemoryRouter>
          <AgentOrgChart parentAgentId="missing" />
        </MemoryRouter>
      </StrictMode>,
    );
    expect(container.querySelector(".org-chart")).toBeNull();
  });

  it("renders without loop errors when given a known root agent", () => {
    useDaemonStore.setState({
      agents: [
        { id: "root", name: "Root", status: "active", trust_id: "root-1" },
        { id: "ceo", name: "CEO", status: "active", trust_id: "root-1" },
        { id: "cto", name: "CTO", status: "active", trust_id: "root-1" },
        { id: "eng", name: "Engineer", status: "idle", trust_id: "root-1" },
      ] as never,
    });
    const errors = captureRenderErrors(
      <StrictMode>
        <MemoryRouter>
          <AgentOrgChart parentAgentId="root" />
        </MemoryRouter>
      </StrictMode>,
    );
    expect(errors.find(isLoopError)).toBeUndefined();
  });

  it("renders the chart shell when the entity has at least one agent", () => {
    useDaemonStore.setState({
      agents: [
        { id: "root", name: "Root", status: "active", trust_id: "root-1" },
        { id: "only", name: "Only", status: "active", trust_id: "root-1" },
      ] as never,
    });
    const { container } = render(
      <StrictMode>
        <MemoryRouter>
          <AgentOrgChart parentAgentId="root" />
        </MemoryRouter>
      </StrictMode>,
    );
    // The chart fetches positions asynchronously; the shell renders
    // synchronously off the agents data, so the outer wrapper is present
    // even before the position fetch resolves.
    expect(container.querySelector(".org-chart")).not.toBeNull();
  });
});

describe("ShortcutsOverlay smoke", () => {
  it("is inert while closed (no portal, no listeners)", () => {
    const errors = captureRenderErrors(
      <StrictMode>
        <ShortcutsOverlay open={false} onClose={() => {}} />
      </StrictMode>,
    );
    expect(errors.find(isLoopError)).toBeUndefined();
  });

  it("renders the cheatsheet when open", () => {
    const errors = captureRenderErrors(
      <StrictMode>
        <ShortcutsOverlay open={true} onClose={() => {}} />
      </StrictMode>,
    );
    expect(errors.find(isLoopError)).toBeUndefined();
    // Both the N spawn hint and the ⌘K palette line should be in the DOM.
    const content = document.body.textContent || "";
    expect(content).toContain("Spawn");
    expect(content).toContain("command palette");
  });
});
