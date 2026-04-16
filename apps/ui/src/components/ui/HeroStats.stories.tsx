import type { Meta, StoryObj } from "@storybook/react";
import { HeroStats } from "./HeroStats";

const meta: Meta<typeof HeroStats> = {
  title: "Components/HeroStats",
  component: HeroStats,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof HeroStats>;

/* ── Dashboard overview ── */

export const DashboardOverview: Story = {
  name: "Dashboard Overview",
  args: {
    stats: [
      { value: 12, label: "Agents" },
      { value: 48, label: "Quests" },
      { value: 1024, label: "Events" },
      { value: 37, label: "Ideas" },
    ],
  },
};

/* ── Runtime health ── */

export const RuntimeHealth: Story = {
  name: "Runtime Health",
  args: {
    stats: [
      { value: 5, label: "Active", color: "success" },
      { value: 3, label: "Idle", color: "muted" },
      { value: 1, label: "Failed", color: "error" },
      { value: "99.2%", label: "Uptime", color: "success" },
    ],
  },
};

/* ── Quest progress ── */

export const QuestProgress: Story = {
  name: "Quest Progress",
  args: {
    stats: [
      { value: 8, label: "In Progress", color: "info" },
      { value: 23, label: "Completed", color: "success" },
      { value: 2, label: "Blocked", color: "warning" },
      { value: 1, label: "Failed", color: "error" },
    ],
  },
};

/* ── Cost tracking ── */

export const CostTracking: Story = {
  name: "Cost Tracking",
  args: {
    stats: [
      { value: "$42.50", label: "Today" },
      { value: "$285.00", label: "This Week" },
      { value: "$1,240", label: "This Month" },
    ],
  },
};

/* ── Single stat ── */

export const SingleStat: Story = {
  name: "Single Stat",
  args: {
    stats: [{ value: 7, label: "Active Agents", color: "success" }],
  },
};
