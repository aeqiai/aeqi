import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import EventsOverview from "@/components/EventsOverview";
import type { AgentEvent } from "@/lib/types";

function event(overrides: Partial<AgentEvent>): AgentEvent {
  return {
    id: overrides.id ?? "event-1",
    agent_id: overrides.agent_id ?? "agent-1",
    name: overrides.name ?? "Session start",
    pattern: overrides.pattern ?? "session:start",
    tool_calls: overrides.tool_calls ?? [{ tool: "ideas.search", args: {} }],
    enabled: overrides.enabled ?? true,
    cooldown_secs: overrides.cooldown_secs ?? 0,
    fire_count: overrides.fire_count ?? 0,
    last_fired: overrides.last_fired,
    total_cost_usd: overrides.total_cost_usd ?? 0,
    system: overrides.system ?? false,
  };
}

describe("EventsOverview", () => {
  it("summarizes lifecycle bucket state and trace coverage", () => {
    render(
      <EventsOverview
        events={[
          event({ id: "armed-runtime", name: "Session start" }),
          event({
            id: "traced-runtime",
            name: "Quest finished",
            pattern: "session:quest_end",
            fire_count: 3,
            last_fired: "2026-05-21T08:15:00Z",
          }),
          event({
            id: "pending-webhook",
            name: "Github webhook",
            pattern: "github:issue_opened",
            fire_count: 1,
          }),
          event({
            id: "dormant-routine",
            name: "Morning digest",
            pattern: "schedule:0 8 * * *",
            enabled: false,
          }),
        ]}
        onSelect={vi.fn()}
        onNew={vi.fn()}
      />,
    );

    const runtime = within(screen.getByLabelText("Runtime status"));
    expect(runtime.getByText("Armed")).toBeInTheDocument();
    expect(runtime.getByText("Fired")).toBeInTheDocument();
    expect(runtime.getByText("Traced")).toBeInTheDocument();

    const webhooks = within(screen.getByLabelText("Webhooks status"));
    expect(webhooks.getByText("Fired")).toBeInTheDocument();
    expect(webhooks.getByText("Pending")).toBeInTheDocument();

    const routines = within(screen.getByLabelText("Routines status"));
    expect(routines.getByText("Dormant")).toBeInTheDocument();

    expect(
      screen.getByLabelText(/Open Morning digest .*when daily 08:00 · cron 0 8 \* \* \*/),
    ).toBeInTheDocument();
  });

  it("numbers ordered tool calls in the automation chain", () => {
    render(
      <EventsOverview
        events={[
          event({
            tool_calls: [
              { tool: "ideas.search", args: {} },
              { tool: "quests.create", args: {} },
            ],
          }),
        ]}
        onSelect={vi.fn()}
        onNew={vi.fn()}
      />,
    );

    const row = screen.getByTestId("event-row");
    expect(within(row).getByText("1")).toBeInTheDocument();
    expect(within(row).getByText("ideas")).toBeInTheDocument();
    expect(within(row).getByText(".search")).toBeInTheDocument();
    expect(within(row).getByText("2")).toBeInTheDocument();
    expect(within(row).getByText("quests")).toBeInTheDocument();
    expect(within(row).getByText(".create")).toBeInTheDocument();
  });
});
