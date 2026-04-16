import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrictMode } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ContentCTA from "@/components/ContentCTA";
import DashboardHome from "@/components/DashboardHome";
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

describe("ContentCTA smoke", () => {
  it("renders without throwing on a non-chat route", () => {
    expect(() =>
      render(
        <StrictMode>
          <MemoryRouter initialEntries={["/root-1/agents"]}>
            <Routes>
              <Route path=":root/*" element={<ContentCTA />} />
            </Routes>
          </MemoryRouter>
        </StrictMode>,
      ),
    ).not.toThrow();
  });

  it("renders without throwing on a root-chat route", () => {
    expect(() =>
      render(
        <StrictMode>
          <MemoryRouter initialEntries={["/root-1/sessions"]}>
            <Routes>
              <Route path=":root/*" element={<ContentCTA />} />
            </Routes>
          </MemoryRouter>
        </StrictMode>,
      ),
    ).not.toThrow();
  });

  it("renders without throwing on a child-agent chat route", () => {
    expect(() =>
      render(
        <StrictMode>
          <MemoryRouter initialEntries={["/root-1/agents/child-2/sessions/abc"]}>
            <Routes>
              <Route path=":root/*" element={<ContentCTA />} />
            </Routes>
          </MemoryRouter>
        </StrictMode>,
      ),
    ).not.toThrow();
  });

  it("does not log a React error during render", () => {
    const errors = captureRenderErrors(
      <StrictMode>
        <MemoryRouter initialEntries={["/root-1/sessions"]}>
          <Routes>
            <Route path=":root/*" element={<ContentCTA />} />
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
            <Route path=":root/*" element={<DashboardHome />} />
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
            <Route path=":root/*" element={<DashboardHome />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );
    expect(errors.find(isLoopError)).toBeUndefined();
  });
});
