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

/* ── Overlay pattern ── */

export const OverlayPattern: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "Demonstrates the canonical data-refetch overlay pattern. The Spinner is centered in a semi-transparent overlay atop existing content. The underlying surface remains visible and interactive (read-only) while background operations complete. Common on tables or detail panels during pagination, search, or background sync.",
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
        <div style={{ fontWeight: 600, fontSize: 13, color: "rgba(0,0,0,0.85)" }}>
          Quests for Orchestrator-7
        </div>
        <div style={{ fontSize: 12, color: "rgba(0,0,0,0.55)" }}>• Validate system config</div>
        <div style={{ fontSize: 12, color: "rgba(0,0,0,0.55)" }}>• Deploy to staging</div>
        <div style={{ fontSize: 12, color: "rgba(0,0,0,0.55)" }}>• Run integration tests</div>
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: "rgba(0, 0, 0, 0.04)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "var(--radius-md)",
        }}
      >
        <Spinner size="md" />
      </div>
    </div>
  ),
};

/* ── Reduced motion ── */

export const ReducedMotion: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "The Spinner respects `prefers-reduced-motion: reduce`. When the OS preference is set (Settings > Accessibility on most platforms), the spinner animation stops and a static indicator remains visible. Document this behavior; the component requires no additional code.",
      },
    },
  },
  render: () => <Spinner size="md" />,
};
