import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import EventTraceTab from "@/components/EventTraceTab";
import type { EventInvocationRow, InvocationStepRow } from "@/lib/types";

const MOCK_INVOCATIONS: EventInvocationRow[] = [
  {
    id: 1,
    session_id: "sess-abc",
    pattern: "session:start",
    event_name: "on_start",
    caller_kind: "System",
    started_at: "2026-04-19T10:00:00.000Z",
    finished_at: "2026-04-19T10:00:00.250Z",
    status: "ok",
    error: null,
    tool_calls_json: "[]",
  },
  {
    id: 2,
    session_id: "sess-abc",
    pattern: "loop:detected",
    event_name: null,
    caller_kind: "Event",
    started_at: "2026-04-19T10:01:00.000Z",
    finished_at: "2026-04-19T10:01:01.500Z",
    status: "error",
    error: "tool failed",
    tool_calls_json: "[]",
  },
];

const MOCK_STEPS: InvocationStepRow[] = [
  {
    id: 10,
    invocation_id: 1,
    step_index: 0,
    tool_name: "shell",
    args_json: '{"cmd":"echo hello"}',
    started_at: "2026-04-19T10:00:00.010Z",
    finished_at: "2026-04-19T10:00:00.220Z",
    result_summary: "hello",
    status: "ok",
    error: null,
  },
];

vi.mock("@/lib/api", () => ({
  api: {
    listInvocations: vi.fn(),
    getInvocationDetail: vi.fn(),
  },
}));

// Import after mock so we get the mocked version.
import { api } from "@/lib/api";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("EventTraceTab smoke", () => {
  it("shows placeholder when no sessionId is provided", () => {
    render(
      <StrictMode>
        <EventTraceTab sessionId="" />
      </StrictMode>,
    );
    expect(screen.getByText(/no session selected/i)).toBeInTheDocument();
  });

  it("renders invocation rows after loading", async () => {
    vi.mocked(api.listInvocations).mockResolvedValue({ ok: true, invocations: MOCK_INVOCATIONS });

    render(
      <StrictMode>
        <EventTraceTab sessionId="sess-abc" />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByText("session:start")).toBeInTheDocument();
    });

    expect(screen.getByText("loop:detected")).toBeInTheDocument();
    // Status values visible in the table
    expect(screen.getAllByText("ok").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("error").length).toBeGreaterThanOrEqual(1);
  });

  it("shows step detail on row click with tool name and result", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listInvocations).mockResolvedValue({ ok: true, invocations: MOCK_INVOCATIONS });
    vi.mocked(api.getInvocationDetail).mockResolvedValue({
      ok: true,
      invocation: MOCK_INVOCATIONS[0],
      steps: MOCK_STEPS,
    });

    render(
      <StrictMode>
        <EventTraceTab sessionId="sess-abc" />
      </StrictMode>,
    );

    // Wait for the table to appear, then click the first row.
    const row = await screen.findByText("session:start");
    await user.click(row);

    await waitFor(() => {
      expect(screen.getByText("shell")).toBeInTheDocument();
    });

    // Args preview rendered in a <pre>
    expect(screen.getByText(/echo hello/)).toBeInTheDocument();
    // Result summary shown
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("back button returns to the invocation table", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listInvocations).mockResolvedValue({ ok: true, invocations: MOCK_INVOCATIONS });
    vi.mocked(api.getInvocationDetail).mockResolvedValue({
      ok: true,
      invocation: MOCK_INVOCATIONS[0],
      steps: MOCK_STEPS,
    });

    render(
      <StrictMode>
        <EventTraceTab sessionId="sess-abc" />
      </StrictMode>,
    );

    await user.click(await screen.findByText("session:start"));
    await screen.findByText("shell");

    await user.click(screen.getByRole("button", { name: /close step detail/i }));

    // Table should be visible again
    await waitFor(() => {
      expect(screen.getByText("session:start")).toBeInTheDocument();
    });
    expect(screen.queryByText("shell")).toBeNull();
  });

  it("shows error state when listInvocations fails", async () => {
    vi.mocked(api.listInvocations).mockRejectedValue(new Error("network error"));

    render(
      <StrictMode>
        <EventTraceTab sessionId="sess-abc" />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByText("network error")).toBeInTheDocument();
    });
  });

  it("shows empty state when there are no invocations", async () => {
    vi.mocked(api.listInvocations).mockResolvedValue({ ok: true, invocations: [] });

    render(
      <StrictMode>
        <EventTraceTab sessionId="sess-abc" />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByText(/no event invocations yet/i)).toBeInTheDocument();
    });
  });

  it("does not trigger React infinite-loop errors during render", async () => {
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args);
    });

    vi.mocked(api.listInvocations).mockResolvedValue({ ok: true, invocations: MOCK_INVOCATIONS });

    render(
      <StrictMode>
        <EventTraceTab sessionId="sess-abc" />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByText("session:start")).toBeInTheDocument();
    });

    spy.mockRestore();

    const loopError = errors.find((e) => {
      const s = Array.isArray(e) ? e.join(" ") : String(e);
      return /Maximum update depth|Minified React error #185|infinite loop/.test(s);
    });
    expect(loopError).toBeUndefined();
  });
});
