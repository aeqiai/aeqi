import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import EventCanvasEditor from "@/components/events/EventCanvasEditor";

describe("EventCanvasEditor", () => {
  it("shows routine cadence on the trigger node", () => {
    render(
      <EventCanvasEditor
        draft={{
          pattern: "schedule:0 8 * * *",
          cooldown_secs: 300,
          tool_calls: [{ tool: "ideas.search", args: {} }],
        }}
        hasFired={false}
        fireCount={0}
        lastFired={null}
        totalCostUsd={0}
        onChange={vi.fn()}
        onShowFires={vi.fn()}
        firesOpen={false}
      />,
    );

    expect(screen.getByText("when daily 08:00 · cron 0 8 * * *")).toBeInTheDocument();
  });
});
