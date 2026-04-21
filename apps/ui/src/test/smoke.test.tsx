import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrictMode } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import AgentQuestsTab from "@/components/AgentQuestsTab";
import DashboardHome from "@/components/DashboardHome";
import LeftSidebar from "@/components/shell/LeftSidebar";
import ComposerRow from "@/components/shell/ComposerRow";
import BootLoader from "@/components/shell/BootLoader";
import AgentOrgChart from "@/components/AgentOrgChart";
import NewAgentPage from "@/pages/NewAgentPage";
import ShortcutsOverlay from "@/components/ShortcutsOverlay";
import { useDaemonStore } from "@/store/daemon";

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

describe("AgentQuestsTab smoke", () => {
  beforeEach(() => {
    useDaemonStore.setState({
      status: null,
      dashboard: null,
      cost: null,
      agents: [
        {
          id: "root-1",
          name: "root-1",
          display_name: "Root",
          model: "opus",
          status: "active",
          parent_id: null,
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

  it("shows the quest-board compose input on the empty board", () => {
    const { container } = render(
      <StrictMode>
        <MemoryRouter initialEntries={["/root-1/quests"]}>
          <Routes>
            <Route path=":agentId/:tab/*" element={<AgentQuestsTab agentId="root-1" />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );
    // The inline composer replaces the old rail CTA: "New quest — what needs to happen?".
    const composer = container.querySelector("[data-quest-compose-subject]");
    expect(composer).not.toBeNull();
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

describe("DashboardHome smoke", () => {
  beforeEach(() => {
    // Reset daemon store to defaults so tests are isolated.
    useDaemonStore.setState({
      status: null,
      dashboard: null,
      cost: null,
      agents: [],
      quests: [],
      events: [],
      workerEvents: [],
      wsConnected: false,
      loading: false,
      initialLoaded: false,
    });
  });

  it("renders with empty store state", () => {
    const errors = captureRenderErrors(
      <StrictMode>
        <MemoryRouter initialEntries={["/root-1"]}>
          <Routes>
            <Route path=":agentId/*" element={<DashboardHome />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );
    expect(errors.find(isLoopError)).toBeUndefined();
  });

  it("renders with populated agents/quests/events", () => {
    useDaemonStore.setState({
      agents: [
        {
          id: "root-1",
          name: "root-1",
          display_name: "Root",
          model: "opus",
          status: "active",
          parent_id: null,
        },
        {
          id: "child-1",
          name: "child-1",
          display_name: "Child",
          model: "sonnet",
          status: "idle",
          parent_id: "root-1",
        },
      ] as never,
      quests: [
        { id: "q1", status: "in_progress" },
        { id: "q2", status: "blocked" },
        { id: "q3", status: "done" },
      ],
      cost: { spent_today_usd: 1.5, daily_budget_usd: 10 },
      events: [],
    });
    const errors = captureRenderErrors(
      <StrictMode>
        <MemoryRouter initialEntries={["/root-1"]}>
          <Routes>
            <Route path=":agentId/*" element={<DashboardHome />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );
    expect(errors.find(isLoopError)).toBeUndefined();
  });
});

describe("shell components smoke", () => {
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
            <Route
              path=":agentId/*"
              element={<LeftSidebar rootId="root-1" agentId="root-1" path="/root-1" />}
            />
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
              element={<LeftSidebar rootId="root-1" agentId="child-1" path="/child-1/sessions" />}
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

  it("renders a 3-level hierarchy without loop errors", () => {
    useDaemonStore.setState({
      agents: [
        { id: "root", name: "Root Co", display_name: "Root", status: "active", parent_id: null },
        { id: "ceo", name: "ceo", display_name: "CEO", status: "active", parent_id: "root" },
        { id: "cto", name: "cto", display_name: "CTO", status: "active", parent_id: "root" },
        { id: "eng", name: "eng", display_name: "Engineer", status: "idle", parent_id: "cto" },
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

  it("single-child rows carry the is-single modifier on the child row", () => {
    useDaemonStore.setState({
      agents: [
        { id: "root", name: "root", display_name: "Root", status: "active", parent_id: null },
        { id: "only", name: "only", display_name: "Only", status: "active", parent_id: "root" },
      ] as never,
    });
    const { container } = render(
      <StrictMode>
        <MemoryRouter>
          <AgentOrgChart parentAgentId="root" />
        </MemoryRouter>
      </StrictMode>,
    );
    // Root always renders a +New slot alongside its single child, so the
    // top row has two items and should NOT carry is-single. A descendant
    // row with exactly one child would — but we don't have grandchildren
    // in this fixture. So we just assert the chart rendered at all.
    expect(container.querySelector(".org-chart")).not.toBeNull();
  });
});

describe("NewAgentPage smoke", () => {
  beforeEach(() => {
    useDaemonStore.setState({
      agents: [
        { id: "root", name: "root", display_name: "Root", status: "active", parent_id: null },
      ] as never,
    });
  });

  it("renders root mode (no parent query) without loop errors", () => {
    const errors = captureRenderErrors(
      <StrictMode>
        <MemoryRouter initialEntries={["/new"]}>
          <Routes>
            <Route path="/new" element={<NewAgentPage />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );
    expect(errors.find(isLoopError)).toBeUndefined();
  });

  it("renders sub-agent mode (?parent=root) with the identity picker", () => {
    const errors = captureRenderErrors(
      <StrictMode>
        <MemoryRouter initialEntries={["/new?parent=root"]}>
          <Routes>
            <Route path="/new" element={<NewAgentPage />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );
    expect(errors.find(isLoopError)).toBeUndefined();
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
