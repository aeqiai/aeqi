import type { Meta, StoryObj } from "@storybook/react";
import { Spinner } from "./Spinner";

const meta: Meta<typeof Spinner> = {
  title: "Primitives/Feedback/Spinner",
  component: Spinner,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
};

export default meta;
type Story = StoryObj<typeof Spinner>;

/* ── Individual sizes ── */

export const Small: Story = {
  args: { size: "sm" },
};

export const Medium: Story = {
  args: { size: "md" },
};

export const Large: Story = {
  args: { size: "lg" },
};

/* ── Size comparison ── */

export const AllSizes: Story = {
  name: "Size Scale",
  render: () => (
    <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
      <div style={{ textAlign: "center" }}>
        <Spinner size="sm" />
        <div style={{ fontSize: 11, color: "rgba(0,0,0,0.35)", marginTop: 8 }}>sm</div>
      </div>
      <div style={{ textAlign: "center" }}>
        <Spinner size="md" />
        <div style={{ fontSize: 11, color: "rgba(0,0,0,0.35)", marginTop: 8 }}>md</div>
      </div>
      <div style={{ textAlign: "center" }}>
        <Spinner size="lg" />
        <div style={{ fontSize: 11, color: "rgba(0,0,0,0.35)", marginTop: 8 }}>lg</div>
      </div>
    </div>
  ),
};

/* ── Contextual usage: inline loading ── */

export const InlineLoading: Story = {
  name: "Inline Loading Pattern",
  render: () => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "12px 16px",
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: 8,
      }}
    >
      <Spinner size="sm" />
      <span style={{ fontSize: 13, color: "rgba(0,0,0,0.55)" }}>
        Connecting to agent runtime...
      </span>
    </div>
  ),
};

/* ── Contextual usage: page loading ── */

export const PageLoading: Story = {
  name: "Page Loading Pattern",
  render: () => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: 48,
        minHeight: 200,
      }}
    >
      <Spinner size="lg" />
      <span style={{ fontSize: 13, color: "rgba(0,0,0,0.4)" }}>Loading dashboard...</span>
    </div>
  ),
};
