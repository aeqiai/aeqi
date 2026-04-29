import { useState, useEffect, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { ThinkingDot } from "./ThinkingDot";

const meta: Meta<typeof ThinkingDot> = {
  title: "Primitives/Feedback/ThinkingDot",
  component: ThinkingDot,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
};

export default meta;
type Story = StoryObj<typeof ThinkingDot>;

export const Small: Story = {
  args: { size: "sm" },
};

export const Medium: Story = {
  args: { size: "md" },
};

export const InlineWithLabel: Story = {
  name: "Inline with Label (Thinking Panel)",
  render: () => (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <ThinkingDot size="sm" />
      <span style={{ fontFamily: "monospace", fontSize: 11, color: "rgba(0,0,0,0.55)" }}>
        thinking...
      </span>
    </div>
  ),
};

export const AsRowStatus: Story = {
  name: "Row Status (Sessions Rail)",
  render: () => (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 10px",
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: 6,
      }}
    >
      <ThinkingDot size="md" />
      <span style={{ fontSize: 13 }}>drafting deploy notes…</span>
    </div>
  ),
};

/* ── Streaming transition ── */

function StreamingTransitionRender(): ReactNode {
  const [state, setState] = useState<"thinking" | "running" | "done">("thinking");

  useEffect(() => {
    const timers = [
      setTimeout(() => setState("running"), 1000),
      setTimeout(() => setState("done"), 2200),
      setTimeout(() => setState("thinking"), 3200),
    ];
    return () => timers.forEach(clearTimeout);
  }, [state]);

  const labels = {
    thinking: "thinking…",
    running: "running tool: fetch_agent_info",
    done: "done",
  };

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {state !== "done" && <ThinkingDot size="sm" />}
      <span style={{ fontFamily: "monospace", fontSize: 11, color: "rgba(0,0,0,0.55)" }}>
        {labels[state]}
      </span>
    </div>
  );
}

export const StreamingTransition: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "Demonstrates the canonical streaming-message state machine. The dot and label cycle through thinking → running tool → done, mimicking the lifecycle of an agent message flowing through Claude. Removes the dot on completion.",
      },
    },
  },
  render: () => <StreamingTransitionRender />,
};

/* ── Reduced motion ── */

export const ReducedMotion: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "The ThinkingDot pulse animation is disabled when `prefers-reduced-motion: reduce` is set. The dot remains static at full opacity. No code changes required; the component respects the OS preference natively.",
      },
    },
  },
  render: () => <ThinkingDot size="md" />,
};
