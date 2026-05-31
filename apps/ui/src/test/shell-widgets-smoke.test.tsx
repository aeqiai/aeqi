import { StrictMode } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AgentOrgChart from "@/components/AgentOrgChart";
import ShortcutsOverlay from "@/components/ShortcutsOverlay";
import { api } from "@/lib/api";
import { useDaemonStore } from "@/store/daemon";

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
        { id: "root", name: "Root", status: "active", company_id: "root-1" },
        { id: "ceo", name: "CEO", status: "active", company_id: "root-1" },
        { id: "cto", name: "CTO", status: "active", company_id: "root-1" },
        { id: "eng", name: "Engineer", status: "idle", company_id: "root-1" },
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
        { id: "root", name: "Root", status: "active", company_id: "root-1" },
        { id: "only", name: "Only", status: "active", company_id: "root-1" },
      ] as never,
    });
    const { container } = render(
      <StrictMode>
        <MemoryRouter>
          <AgentOrgChart parentAgentId="root" />
        </MemoryRouter>
      </StrictMode>,
    );
    expect(container.querySelector(".org-chart")).not.toBeNull();
  });
});

describe("ShortcutsOverlay smoke", () => {
  it("is inert while closed", () => {
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
    const content = document.body.textContent || "";
    expect(content).toContain("Spawn");
    expect(content).toContain("command palette");
  });
});
