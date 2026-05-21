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
    tool_calls:
      overrides.tool_calls === undefined
        ? [{ tool: "ideas.search", args: {} }]
        : overrides.tool_calls,
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
            cooldown_secs: 300,
            tool_calls: null,
          }),
        ]}
        onSelect={vi.fn()}
        onNew={vi.fn()}
      />,
    );

    const runtime = within(screen.getByLabelText("Runtime status"));
    expect(runtime.getByText("Armed")).toBeInTheDocument();
    expect(runtime.getByText("Fired")).toBeInTheDocument();
    expect(runtime.getByText("Ready")).toBeInTheDocument();
    expect(runtime.getByText("Calls")).toBeInTheDocument();
    expect(runtime.getByText("Trace Done")).toBeInTheDocument();

    const webhooks = within(screen.getByLabelText("Webhooks status"));
    expect(webhooks.getByText("Fired")).toBeInTheDocument();
    expect(webhooks.getByText("Ready")).toBeInTheDocument();
    expect(webhooks.getByText("Calls")).toBeInTheDocument();
    expect(webhooks.getByText("Trace Pending")).toBeInTheDocument();

    const webhookRow = screen.getByLabelText(/Open Github webhook/);
    expect(within(webhookRow).getAllByText("GitHub webhook")).toHaveLength(2);

    const routines = within(screen.getByLabelText("Routines status"));
    expect(routines.getByText("Dormant")).toBeInTheDocument();
    expect(routines.getByText("Observers")).toBeInTheDocument();
    expect(routines.getByText("Guarded")).toBeInTheDocument();

    const routineRow = screen.getByLabelText(/Open Morning digest/);
    expect(within(routineRow).getAllByText("cron scheduler")).toHaveLength(2);
    expect(within(routineRow).getAllByText("Disabled")).toHaveLength(3);
    expect(within(routineRow).getByText("why")).toBeInTheDocument();
    expect(within(routineRow).getByText("when")).toBeInTheDocument();
    expect(within(routineRow).getByText("gate")).toBeInTheDocument();
    expect(within(routineRow).getByText("fire")).toBeInTheDocument();
    expect(within(routineRow).getAllByText("disabled, 5m cooldown")).toHaveLength(2);
    expect(within(routineRow).getByText("no tool calls")).toBeInTheDocument();
    expect(within(routineRow).getByText("0 tool calls")).toBeInTheDocument();
    expect(within(routineRow).getAllByText("no trace")).toHaveLength(2);

    expect(
      screen.getByLabelText(
        /Open Morning digest .*when daily 08:00 · cron 0 8 \* \* \*.*gate disabled, 5m cooldown/,
      ),
    ).toBeInTheDocument();
  });

  it("numbers ordered tool calls in the automation chain", () => {
    render(
      <EventsOverview
        events={[
          event({
            tool_calls: [
              { tool: "ideas.search", args: { query: "status", limit: 3 } },
              { tool: "quests.create", args: {} },
            ],
          }),
        ]}
        onSelect={vi.fn()}
        onNew={vi.fn()}
      />,
    );

    const row = screen.getByTestId("event-row");
    expect(within(row).getByText("call 1")).toBeInTheDocument();
    expect(within(row).getByText("ideas")).toBeInTheDocument();
    expect(within(row).getByText(".search")).toBeInTheDocument();
    expect(within(row).getByText('query "status" +1')).toBeInTheDocument();
    expect(within(row).getByText("call 2")).toBeInTheDocument();
    expect(within(row).getByText("quests")).toBeInTheDocument();
    expect(within(row).getByText(".create")).toBeInTheDocument();
    expect(within(row).getByText("gate")).toBeInTheDocument();
    expect(within(row).getAllByText("ready to fire")).toHaveLength(2);
    expect(within(row).getByText("fire")).toBeInTheDocument();
    expect(within(row).getAllByText("Armed")).toHaveLength(3);
    expect(within(row).getByText("trace")).toBeInTheDocument();
  });

  it("parses cron-prefixed routines into cadence labels", () => {
    render(
      <EventsOverview
        events={[
          event({
            id: "cron-routine",
            name: "Quarter-hour digest",
            pattern: "cron:*/15 * * * *",
          }),
        ]}
        onSelect={vi.fn()}
        onNew={vi.fn()}
      />,
    );

    const row = screen.getByLabelText(/Open Quarter-hour digest/);
    expect(within(row).getAllByText("cron scheduler")).toHaveLength(2);
    expect(within(row).getAllByText("every 15m · cron */15 * * * *")).toHaveLength(2);
  });

  it("names common routine cadences in the run chain", () => {
    render(
      <EventsOverview
        events={[
          event({
            id: "weekday-routine",
            name: "Weekday brief",
            pattern: "schedule:30 9 * * 1-5",
          }),
          event({
            id: "hourly-routine",
            name: "Hourly sweep",
            pattern: "schedule:5 * * * *",
          }),
          event({
            id: "sunday-routine",
            name: "Sunday review",
            pattern: "schedule:0 10 * * 7",
          }),
        ]}
        onSelect={vi.fn()}
        onNew={vi.fn()}
      />,
    );

    expect(
      within(screen.getByLabelText(/Open Weekday brief/)).getAllByText(
        "weekdays 09:30 · cron 30 9 * * 1-5",
      ),
    ).toHaveLength(2);
    expect(
      within(screen.getByLabelText(/Open Hourly sweep/)).getAllByText(
        "hourly at :05 · cron 5 * * * *",
      ),
    ).toHaveLength(2);
    expect(
      within(screen.getByLabelText(/Open Sunday review/)).getAllByText(
        "weekly Sun 10:00 · cron 0 10 * * 7",
      ),
    ).toHaveLength(2);
  });
});
