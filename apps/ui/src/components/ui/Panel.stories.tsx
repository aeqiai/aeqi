import type { Meta, StoryObj } from "@storybook/react";
import { Panel } from "./Panel";
import { Badge, StatusBadge } from "./Badge";
import { HeroStats } from "./HeroStats";
import { Button } from "./Button";

const meta: Meta<typeof Panel> = {
  title: "Primitives/Containers/Panel",
  component: Panel,
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "detail"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Panel>;

/* ── Basic ── */

export const Default: Story = {
  args: {
    title: "Active Quests",
    children: (
      <div style={{ padding: "16px", color: "rgba(0,0,0,0.55)", fontSize: 13 }}>
        Panel content goes here
      </div>
    ),
  },
};

export const DetailVariant: Story = {
  args: {
    title: "Agent Details",
    variant: "detail",
    children: (
      <div style={{ padding: "16px" }}>
        <p style={{ fontSize: 13, color: "rgba(0,0,0,0.55)" }}>
          Detail panel with additional information about the agent.
        </p>
      </div>
    ),
  },
};

/* ── Panel with stats content (dashboard-like) ── */

export const WithStats: Story = {
  name: "Dashboard Stats Panel",
  render: () => (
    <div style={{ maxWidth: 600 }}>
      <Panel title="Runtime Overview">
        <div style={{ padding: "8px 16px 16px" }}>
          <HeroStats
            stats={[
              { value: 7, label: "Agents", color: "default" },
              { value: 23, label: "Quests", color: "info" },
              { value: 142, label: "Events", color: "muted" },
              { value: "$18.40", label: "Cost" },
            ]}
          />
        </div>
      </Panel>
    </div>
  ),
};

/* ── Panel with a list of items ── */

export const WithItemList: Story = {
  name: "Quest List Panel",
  render: () => {
    const quests = [
      { name: "Refactor auth module", status: "in_progress", agent: "code-reviewer" },
      { name: "Write migration script", status: "pending", agent: "---" },
      { name: "Deploy v0.5.0", status: "blocked", agent: "deploy-agent" },
      { name: "Update API docs", status: "done", agent: "docs-writer" },
    ];

    return (
      <div style={{ maxWidth: 520 }}>
        <Panel
          title="Recent Quests"
          actions={
            <a
              href="#"
              style={{
                fontSize: 12,
                color: "rgba(0,0,0,0.4)",
                textDecoration: "none",
              }}
            >
              View all
            </a>
          }
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            {quests.map((q, i) => (
              <div
                key={q.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 16px",
                  borderTop: i > 0 ? "1px solid rgba(0,0,0,0.06)" : undefined,
                }}
              >
                <span style={{ fontSize: 13, color: "rgba(0,0,0,0.85)", flex: 1 }}>{q.name}</span>
                <StatusBadge status={q.status} size="sm" />
                <code
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: 11,
                    color: "rgba(0,0,0,0.35)",
                    minWidth: 100,
                    textAlign: "right",
                  }}
                >
                  {q.agent}
                </code>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    );
  },
};

/* ── Panel with actions ── */

export const WithActions: Story = {
  name: "Panel with Actions",
  render: () => (
    <div style={{ maxWidth: 480 }}>
      <Panel
        title="Agent: code-reviewer"
        actions={
          <div style={{ display: "flex", gap: 6 }}>
            <Badge variant="success" dot size="sm">
              Active
            </Badge>
          </div>
        }
      >
        <div style={{ padding: 16 }}>
          <p style={{ fontSize: 13, color: "rgba(0,0,0,0.55)", margin: "0 0 16px" }}>
            Reviews pull requests, checks for code quality issues, and suggests improvements based
            on established patterns.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="secondary" size="sm">
              View Quests
            </Button>
            <Button variant="ghost" size="sm">
              Edit
            </Button>
          </div>
        </div>
      </Panel>
    </div>
  ),
};

/* ── Nested panels ── */

export const NestedPanels: Story = {
  name: "Nested Panels",
  render: () => (
    <div style={{ maxWidth: 520 }}>
      <Panel title="Agent Hierarchy">
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <Panel title="orchestrator" variant="detail">
            <div style={{ padding: "8px 16px" }}>
              <p style={{ fontSize: 12, color: "rgba(0,0,0,0.4)", margin: 0 }}>
                Root agent. Delegates work to child agents.
              </p>
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                <Panel variant="detail">
                  <div
                    style={{
                      padding: "8px 16px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <code style={{ fontSize: 12 }}>code-reviewer</code>
                    <StatusBadge status="working" size="sm" />
                  </div>
                </Panel>
                <Panel variant="detail">
                  <div
                    style={{
                      padding: "8px 16px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <code style={{ fontSize: 12 }}>test-runner</code>
                    <StatusBadge status="idle" size="sm" />
                  </div>
                </Panel>
              </div>
            </div>
          </Panel>
        </div>
      </Panel>
    </div>
  ),
};

/* ── No title ── */

export const NoTitle: Story = {
  args: {
    children: (
      <div style={{ padding: "16px", color: "rgba(0,0,0,0.55)", fontSize: 13 }}>
        Panels without titles are useful for grouping content without extra visual weight.
      </div>
    ),
  },
};
