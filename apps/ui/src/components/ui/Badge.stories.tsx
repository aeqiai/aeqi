import type { Meta, StoryObj } from "@storybook/react";
import { Badge, StatusBadge } from "./Badge";

const meta: Meta<typeof Badge> = {
  title: "Primitives/Data Display/Badge",
  component: Badge,
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["neutral", "info", "success", "warning", "error", "muted", "accent"],
    },
    size: {
      control: "select",
      options: ["sm", "md"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Badge>;

/* ── Individual variants ── */

export const Neutral: Story = {
  args: { children: "Idle", variant: "neutral", dot: true },
};

export const Success: Story = {
  args: { children: "Active", variant: "success", dot: true },
};

export const Accent: Story = {
  args: { children: "Working", variant: "accent", dot: true },
};

export const Error: Story = {
  args: { children: "Failed", variant: "error", dot: true },
};

export const Warning: Story = {
  args: { children: "Blocked", variant: "warning", dot: true },
};

export const Info: Story = {
  args: { children: "In Progress", variant: "info", dot: true },
};

export const Muted: Story = {
  args: { children: "Offline", variant: "muted", dot: true },
};

/* ── Agent status indicators ── */

export const AgentStatus: Story = {
  name: "Agent Status Indicators",
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p
        style={{
          fontSize: 12,
          color: "rgba(0,0,0,0.4)",
          margin: 0,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        Agent lifecycle states
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <StatusBadge status="idle" />
        <StatusBadge status="working" />
        <StatusBadge status="offline" />
      </div>
    </div>
  ),
};

/* ── Quest priority badges ── */

export const QuestPriority: Story = {
  name: "Quest Status Badges",
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p
        style={{
          fontSize: 12,
          color: "rgba(0,0,0,0.4)",
          margin: 0,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        Quest lifecycle states
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <StatusBadge status="pending" />
        <StatusBadge status="in_progress" />
        <StatusBadge status="done" />
        <StatusBadge status="blocked" />
        <StatusBadge status="failed" />
        <StatusBadge status="cancelled" />
      </div>
    </div>
  ),
};

/* ── Dashboard status row ── */

export const DashboardStatusRow: Story = {
  name: "Dashboard Status Row",
  render: () => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        maxWidth: 480,
      }}
    >
      {[
        { name: "code-reviewer", status: "working" as const, quest: "Review PR #142" },
        { name: "deploy-agent", status: "idle" as const, quest: "---" },
        { name: "test-runner", status: "working" as const, quest: "Run integration suite" },
        { name: "docs-writer", status: "offline" as const, quest: "---" },
      ].map((agent) => (
        <div
          key={agent.name}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 14px",
            border: "1px solid rgba(0,0,0,0.08)",
            borderRadius: 8,
          }}
        >
          <code
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 13,
              color: "rgba(0,0,0,0.85)",
              minWidth: 120,
            }}
          >
            {agent.name}
          </code>
          <StatusBadge status={agent.status} size="sm" />
          <span
            style={{
              marginLeft: "auto",
              fontSize: 12,
              color: "rgba(0,0,0,0.4)",
            }}
          >
            {agent.quest}
          </span>
        </div>
      ))}
    </div>
  ),
};

/* ── Size comparison ── */

export const SizeComparison: Story = {
  name: "Size Comparison",
  render: () => (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <Badge variant="success" dot size="sm">
        sm
      </Badge>
      <Badge variant="success" dot size="md">
        md
      </Badge>
    </div>
  ),
};

/* ── Without dot ── */

export const NoDot: Story = {
  name: "Without Dot",
  args: { children: "v0.5.0", variant: "neutral" },
};
