import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import AgentQuestsTab from "@/components/AgentQuestsTab";
import AppLayout from "@/components/AppLayout";
import LeftSidebar from "@/components/shell/LeftSidebar";
import ComposerRow from "@/components/shell/ComposerRow";
import BootLoader from "@/components/shell/BootLoader";
import AgentOrgChart from "@/components/AgentOrgChart";
import ShortcutsOverlay from "@/components/ShortcutsOverlay";
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
 * Version B routes: `/:agentId/[:tab[/:itemId]]` — every agent (root or
 * child) at top level. No `/agents/` segment.
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
          <MemoryRouter initialEntries={["/root-1/quests"]}>
            <Routes>
              <Route path=":agentId/:tab/*" element={<AgentQuestsTab agentId="root-1" />} />
            </Routes>
          </MemoryRouter>
        </StrictMode>,
      ),
    ).not.toThrow();
  });

  it("exposes a New quest button on the empty board", () => {
    const { container } = render(
      <StrictMode>
        <MemoryRouter initialEntries={["/root-1/quests"]}>
          <Routes>
            <Route path=":agentId/:tab/*" element={<AgentQuestsTab agentId="root-1" />} />
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
        <MemoryRouter initialEntries={["/root-1/quests"]}>
          <Routes>
            <Route path=":agentId/:tab/*" element={<AgentQuestsTab agentId="root-1" />} />
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
      <StrictMode>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route index element={<ShellUnderTest />} />
            <Route path=":agentId" element={<ShellUnderTest />} />
            <Route path=":agentId/:tab" element={<ShellUnderTest />} />
            <Route path=":agentId/:tab/:itemId" element={<ShellUnderTest />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/root-1"));
  });

  it("migrates old top-level quest URLs into the company route", async () => {
    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/quests"]}>
          <Routes>
            <Route index element={<ShellUnderTest />} />
            <Route path=":agentId" element={<ShellUnderTest />} />
            <Route path=":agentId/:tab" element={<ShellUnderTest />} />
            <Route path=":agentId/:tab/:itemId" element={<ShellUnderTest />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/root-1/quests"));
  });

  it("migrates child-agent quest URLs back to the company route", async () => {
    useDaemonStore.setState({
      agents: [
        { id: "root-1", name: "Root", status: "active", entity_id: "root-1" },
        { id: "eng-1", name: "Engineer", status: "active", entity_id: "root-1" },
      ] as never,
    });

    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/eng-1/quests/q-1"]}>
          <Routes>
            <Route index element={<ShellUnderTest />} />
            <Route path=":agentId" element={<ShellUnderTest />} />
            <Route path=":agentId/:tab" element={<ShellUnderTest />} />
            <Route path=":agentId/:tab/:itemId" element={<ShellUnderTest />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/root-1/quests/q-1"),
    );
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
      <StrictMode>
        <MemoryRouter initialEntries={["/root-1"]}>
          <Routes>
            <Route path=":agentId/*" element={<LeftSidebar agentId="root-1" path="/root-1" />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );
    expect(errors.find(isLoopError)).toBeUndefined();
  });

  it("LeftSidebar renders with a drilled-in child agent", () => {
    const errors = captureRenderErrors(
      <StrictMode>
        <MemoryRouter initialEntries={["/child-1/sessions"]}>
          <Routes>
            <Route
              path=":agentId/*"
              element={<LeftSidebar agentId="child-1" path="/child-1/sessions" />}
            />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );
    expect(errors.find(isLoopError)).toBeUndefined();
  });

  it("ComposerRow renders without a mounted chat (pending-message path)", () => {
    const errors = captureRenderErrors(
      <StrictMode>
        <MemoryRouter initialEntries={["/root-1"]}>
          <Routes>
            <Route
              path=":agentId/*"
              element={<ComposerRow agentId={null} base="/root-1" sessionsMounted={false} />}
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
        <MemoryRouter initialEntries={["/root-1/sessions"]}>
          <Routes>
            <Route
              path=":agentId/*"
              element={<ComposerRow agentId="root-1" base="/root-1" sessionsMounted={true} />}
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
    useDaemonStore.setState({
      entities: [],
      agents: [],
      quests: [],
      events: [],
    } as never);
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
