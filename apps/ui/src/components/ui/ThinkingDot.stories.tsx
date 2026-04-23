import type { Meta, StoryObj } from "@storybook/react";
import { ThinkingDot } from "./ThinkingDot";

const meta: Meta<typeof ThinkingDot> = {
  title: "Feedback/ThinkingDot",
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
