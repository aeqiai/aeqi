import type { Meta, StoryObj } from "@storybook/react";
import { ProgressBar } from "./ProgressBar";

const meta: Meta<typeof ProgressBar> = {
  title: "Primitives/Data Display/ProgressBar",
  component: ProgressBar,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div style={{ width: 320 }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ProgressBar>;

/* ── Standard states ── */

export const Empty: Story = {
  args: { value: 0, label: "0%" },
};

export const InProgress: Story = {
  name: "In Progress",
  args: { value: 42, label: "42%" },
};

export const Complete: Story = {
  args: { value: 100, label: "100%" },
};

/* ── Quest progress ── */

export const QuestCompletion: Story = {
  name: "Quest Task Completion",
  args: { value: 7, max: 10, label: "7 of 10 tasks complete" },
};

/* ── Multiple progress bars ── */

export const AgentWorkload: Story = {
  name: "Agent Workload",
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 360 }}>
      {[
        { agent: "code-reviewer", current: 8, max: 10 },
        { agent: "deploy-agent", current: 2, max: 10 },
        { agent: "test-runner", current: 6, max: 10 },
        { agent: "docs-writer", current: 0, max: 10 },
      ].map((a) => (
        <div key={a.agent}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 6,
            }}
          >
            <code
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 12,
                color: "rgba(0,0,0,0.7)",
              }}
            >
              {a.agent}
            </code>
            <span style={{ fontSize: 12, color: "rgba(0,0,0,0.4)" }}>
              {a.current}/{a.max}
            </span>
          </div>
          <ProgressBar value={a.current} max={a.max} />
        </div>
      ))}
    </div>
  ),
};
