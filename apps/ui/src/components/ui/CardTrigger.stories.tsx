import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { CardTrigger } from "./CardTrigger";
import { Card } from "./Card";

const meta: Meta<typeof CardTrigger> = {
  title: "UI/CardTrigger",
  component: CardTrigger,
  argTypes: {
    onClick: { action: "clicked" },
    disabled: { control: "boolean" },
    "aria-label": { control: "text" },
  },
};

export default meta;
type Story = StoryObj<typeof CardTrigger>;

/**
 * Default: A row-style card with icon + text content.
 * Shows cursor pointer on hover, subtle background tint, and focus ring.
 */
export const Default: Story = {
  render: () => (
    <div style={{ maxWidth: 400 }}>
      <CardTrigger onClick={() => alert("Clicked agent card")} aria-label="Open agent details">
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}>
          {/* Icon placeholder */}
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 8,
              background: "var(--color-bg-elevated)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            👤
          </div>
          {/* Content */}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)" }}>
              Alice Agent
            </div>
            <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 2 }}>
              Active • 3 quests
            </div>
          </div>
        </div>
      </CardTrigger>
    </div>
  ),
};

/**
 * WithCardChrome: CardTrigger composed with the Card primitive.
 * Shows the full integrated pattern: Card provides chrome, CardTrigger
 * makes it interactive.
 */
export const WithCardChrome: Story = {
  render: () => (
    <div style={{ maxWidth: 400 }}>
      <CardTrigger onClick={() => alert("Clicked composited card")} aria-label="Open idea">
        <Card interactive={false}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            {/* Icon */}
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 6,
                background: "var(--color-bg-elevated)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                fontSize: 18,
              }}
            >
              💡
            </div>
            {/* Content */}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)" }}>
                Improve multi-agent coordination
              </div>
              <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>
                Candidate • #skill • created 2 days ago
              </div>
            </div>
          </div>
        </Card>
      </CardTrigger>
    </div>
  ),
};

/**
 * Disabled: CardTrigger in disabled state.
 * Shows reduced opacity, no-pointer cursor, and prevents clicks.
 */
export const Disabled: Story = {
  render: () => (
    <div style={{ maxWidth: 400 }}>
      <CardTrigger
        onClick={() => alert("This should not fire")}
        disabled={true}
        aria-label="Open (disabled)"
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}>
          {/* Icon */}
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 8,
              background: "var(--color-bg-elevated)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            🔒
          </div>
          {/* Content */}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)" }}>
              Locked Agent
            </div>
            <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 2 }}>
              Unavailable • requires permissions
            </div>
          </div>
        </div>
      </CardTrigger>
    </div>
  ),
};

function InteractiveListExample() {
  const [selected, setSelected] = useState<string | null>(null);

  const agents = [
    { id: "1", name: "Alice", status: "Active", icon: "👤" },
    { id: "2", name: "Bob", status: "Idle", icon: "🤖" },
    { id: "3", name: "Charlie", status: "Active", icon: "⚙️" },
  ];

  return (
    <div style={{ maxWidth: 400, display: "flex", flexDirection: "column", gap: 8 }}>
      {agents.map((agent) => (
        <CardTrigger
          key={agent.id}
          onClick={() => setSelected(agent.id)}
          aria-label={`Select ${agent.name}`}
          style={{
            borderRadius: 8,
            border: selected === agent.id ? "1px solid var(--border-accent)" : undefined,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                background: "var(--color-bg-elevated)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                fontSize: 18,
              }}
            >
              {agent.icon}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)" }}>
                {agent.name}
              </div>
              <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 2 }}>
                {agent.status}
              </div>
            </div>
            {selected === agent.id && (
              <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--color-accent)" }}>
                ✓
              </div>
            )}
          </div>
        </CardTrigger>
      ))}
    </div>
  );
}

/**
 * Interactive list: Three CardTriggers in sequence, showing how they stack
 * and how selection state can be tracked via onClick.
 */
export const InteractiveList: Story = {
  render: () => <InteractiveListExample />,
};
