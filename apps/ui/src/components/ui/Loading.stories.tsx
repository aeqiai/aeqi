import type { Meta, StoryObj } from "@storybook/react";
import { Loading } from "./Loading";

const meta: Meta<typeof Loading> = {
  title: "Primitives/Feedback/Loading",
  component: Loading,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
};

export default meta;
type Story = StoryObj<typeof Loading>;

export const Inline: Story = {
  args: { variant: "inline", size: "sm", label: "Loading agents", showLabel: true },
};

export const Section: Story = {
  args: { variant: "section", label: "Loading quest history" },
};

export const Page: Story = {
  parameters: {
    layout: "fullscreen",
  },
  args: { variant: "page", label: "Loading application" },
};

export const AllSizes: Story = {
  name: "Size Scale",
  render: () => (
    <div style={{ display: "flex", gap: "var(--space-6)", alignItems: "center" }}>
      <Loading size="sm" label="Loading small" showLabel />
      <Loading size="md" label="Loading medium" showLabel />
      <Loading size="lg" label="Loading large" showLabel />
    </div>
  ),
};

export const OverlayPattern: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "Use the loading mark in overlays when background data refreshes over existing content. Keep the underlying surface visible so the user retains context.",
      },
    },
  },
  render: () => (
    <div style={{ position: "relative" }}>
      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          padding: "var(--space-4)",
          minHeight: 200,
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 13, color: "var(--color-text-primary)" }}>
          Quests for Orchestrator-7
        </div>
        <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
          Validate system config
        </div>
        <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Deploy to staging</div>
        <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
          Run integration tests
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: "color-mix(in srgb, var(--color-card) 74%, transparent)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "var(--radius-md)",
        }}
      >
        <Loading size="md" label="Refreshing quests" />
      </div>
    </div>
  ),
};

export const ReducedMotion: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "The pulse animation disables under prefers-reduced-motion. The mark remains visible at full opacity instead of switching to a rotating indicator.",
      },
    },
  },
  args: { size: "md", label: "Loading without motion", showLabel: true },
};
