import type { Meta, StoryObj } from "@storybook/react";
import { Tabs } from "./Tabs";
import { StatusBadge } from "./Badge";

const meta: Meta<typeof Tabs> = {
  title: "Components/Tabs",
  component: Tabs,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Tabs>;

/* ── Agent detail tabs ── */

export const AgentDetailTabs: Story = {
  name: "Agent Detail Tabs",
  args: {
    tabs: [
      {
        id: "overview",
        label: "Overview",
        content: (
          <div style={{ padding: 16, fontSize: 13, color: "rgba(0,0,0,0.55)" }}>
            Agent identity, model configuration, and current status.
          </div>
        ),
      },
      {
        id: "quests",
        label: "Quests",
        count: 3,
        content: (
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            {["Refactor auth module", "Write migration script", "Review PR #142"].map((q) => (
              <div
                key={q}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 0",
                  borderBottom: "1px solid rgba(0,0,0,0.06)",
                  fontSize: 13,
                }}
              >
                <span style={{ color: "rgba(0,0,0,0.85)" }}>{q}</span>
                <StatusBadge status="in_progress" size="sm" />
              </div>
            ))}
          </div>
        ),
      },
      {
        id: "events",
        label: "Events",
        count: 142,
        content: (
          <div style={{ padding: 16, fontSize: 13, color: "rgba(0,0,0,0.55)" }}>
            Activity stream for this agent.
          </div>
        ),
      },
      {
        id: "ideas",
        label: "Ideas",
        count: 5,
        content: (
          <div style={{ padding: 16, fontSize: 13, color: "rgba(0,0,0,0.55)" }}>
            Knowledge, identity, and instructions attached to this agent.
          </div>
        ),
      },
    ],
  },
};

/* ── Quest filter tabs ── */

export const QuestFilterTabs: Story = {
  name: "Quest Filter Tabs",
  args: {
    tabs: [
      {
        id: "all",
        label: "All",
        count: 34,
        content: (
          <div style={{ padding: 16, fontSize: 13, color: "rgba(0,0,0,0.55)" }}>
            All quests across all agents and statuses.
          </div>
        ),
      },
      {
        id: "active",
        label: "Active",
        count: 8,
        content: (
          <div style={{ padding: 16, fontSize: 13, color: "rgba(0,0,0,0.55)" }}>
            Quests currently being worked on by agents.
          </div>
        ),
      },
      {
        id: "blocked",
        label: "Blocked",
        count: 2,
        content: (
          <div style={{ padding: 16, fontSize: 13, color: "rgba(0,0,0,0.55)" }}>
            Quests that need attention or are waiting on dependencies.
          </div>
        ),
      },
      {
        id: "done",
        label: "Done",
        count: 24,
        content: (
          <div style={{ padding: 16, fontSize: 13, color: "rgba(0,0,0,0.55)" }}>
            Completed quests.
          </div>
        ),
      },
    ],
  },
};

/* ── Simple two-tab ── */

export const SettingsTabs: Story = {
  name: "Settings Tabs",
  args: {
    tabs: [
      {
        id: "connection",
        label: "Connection",
        content: (
          <div style={{ padding: 16, fontSize: 13, color: "rgba(0,0,0,0.55)" }}>
            Daemon endpoint, authentication, and runtime configuration.
          </div>
        ),
      },
      {
        id: "preferences",
        label: "Preferences",
        content: (
          <div style={{ padding: 16, fontSize: 13, color: "rgba(0,0,0,0.55)" }}>
            UI theme, layout preferences, and notification settings.
          </div>
        ),
      },
    ],
  },
};
