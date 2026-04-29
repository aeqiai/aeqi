import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import AgentQuestsTab from "@/components/AgentQuestsTab";
import AppLayout from "@/components/AppLayout";
import LeftSidebar from "@/components/shell/LeftSidebar";
import ComposerRow from "@/components/shell/ComposerRow";
import BootLoader from "@/components/shell/BootLoader";
import AgentOrgChart from "@/components/AgentOrgChart";
import ShortcutsOverlay from "@/components/ShortcutsOverlay";
import { agentKeys, entityKeys, runtimeKeys } from "@/queries/keys";
import { api } from "@/lib/api";
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
 * Canonical routes: `/c/:entityId/[:tab[/:itemId]]`. The entity-root
 * agent renders at `/c/:entityId/...`; per-agent drilldowns live at
 * `/c/:entityId/agents/:agentId/...`.
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
          entity_id: "root-1",
        },
      ] as never,
      quests: [],
      events: [],
      workerEvents: [],
      wsConnected: false,
      loading: false,
      initialLoaded: false,
    });
  });

  it("renders the board view without throwing when no quest is selected", () => {
    expect(() =>
      render(
        <StrictMode>
          <MemoryRouter initialEntries={["/c/root-1/quests"]}>
            <Routes>
              <Route path="c/:entityId/:tab/*" element={<AgentQuestsTab agentId="root-1" />} />
            </Routes>
          </MemoryRouter>
        </StrictMode>,
      ),
    ).not.toThrow();
  });

  it("exposes a New quest button on the empty board", () => {
    const { container } = render(
      <StrictMode>
        <MemoryRouter initialEntries={["/c/root-1/quests"]}>
          <Routes>
            <Route path="c/:entityId/:tab/*" element={<AgentQuestsTab agentId="root-1" />} />
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

  it("does not log a React error during render", () => {
    const errors = captureRenderErrors(
      <StrictMode>
        <MemoryRouter initialEntries={["/c/root-1/quests"]}>
          <Routes>
            <Route path="c/:entityId/:tab/*" element={<AgentQuestsTab agentId="root-1" />} />
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
          type: "company",
          status: "active",
          created_at: "2026-04-28T00:00:00Z",
        },
      ],
      agents: [{ id: "root-1", name: "Root", status: "active", entity_id: "root-1" }] as never,
      quests: [],
      events: [],
      workerEvents: [],
      wsConnected: false,
      loading: false,
      initialLoaded: true,
    });
  });

  it("canonicalizes / to the selected company root", async () => {
    render(
      withQueryClient(
        <StrictMode>
          <MemoryRouter initialEntries={["/"]}>
            <Routes>
              <Route index element={<ShellUnderTest />} />
              <Route path="c/:entityId" element={<ShellUnderTest />} />
              <Route path="c/:entityId/:tab" element={<ShellUnderTest />} />
              <Route path="c/:entityId/:tab/:itemId" element={<ShellUnderTest />} />
            </Routes>
          </MemoryRouter>
        </StrictMode>,
      ),
    );

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/c/root-1"));
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
          <MemoryRouter initialEntries={["/c/root-1"]}>
            <Routes>
              <Route
                path="c/:entityId/*"
                element={<LeftSidebar entityId="root-1" path="/c/root-1" />}
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
          <MemoryRouter initialEntries={["/c/root-1/agents/child-1/sessions"]}>
            <Routes>
              <Route
                path="c/:entityId/*"
                element={<LeftSidebar entityId="root-1" path="/c/root-1/agents/child-1/sessions" />}
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
        <MemoryRouter initialEntries={["/c/root-1"]}>
          <Routes>
            <Route
              path="c/:entityId/*"
              element={<ComposerRow agentId={null} base="/c/root-1" sessionsMounted={false} />}
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
        <MemoryRouter initialEntries={["/c/root-1/sessions"]}>
          <Routes>
            <Route
              path="c/:entityId/*"
              element={<ComposerRow agentId="root-1" base="/c/root-1" sessionsMounted={true} />}
            />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );
    expect(errors.find(isLoopError)).toBeUndefined();
  });
});

describe("AgentOrgChart smoke", () => {
  beforeEach(() => {
    vi.spyOn(api, "getPositions").mockImplementation(() => new Promise(() => {}));
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
        { id: "root", name: "Root", status: "active", entity_id: "root-1" },
        { id: "ceo", name: "CEO", status: "active", entity_id: "root-1" },
        { id: "cto", name: "CTO", status: "active", entity_id: "root-1" },
        { id: "eng", name: "Engineer", status: "idle", entity_id: "root-1" },
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
        { id: "root", name: "Root", status: "active", entity_id: "root-1" },
        { id: "only", name: "Only", status: "active", entity_id: "root-1" },
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
