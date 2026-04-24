import type { Meta, StoryObj } from "@storybook/react";
import { DetailField } from "./DetailField";
import { Badge, StatusBadge } from "./Badge";
import { TagList } from "./TagList";

const meta: Meta<typeof DetailField> = {
  title: "Primitives/Data Display/DetailField",
  component: DetailField,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof DetailField>;

/* ── Individual fields ── */

export const Default: Story = {
  args: {
    label: "Agent Name",
    children: "code-reviewer",
  },
};

export const WithBadge: Story = {
  args: {
    label: "Status",
    children: (
      <Badge variant="success" dot>
        Active
      </Badge>
    ),
  },
};

export const WithMonoText: Story = {
  name: "With Monospace Value",
  args: {
    label: "Model",
    children: (
      <code
        style={{
          fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
          fontSize: "var(--font-size-sm, 13px)",
        }}
      >
        claude-3-opus
      </code>
    ),
  },
};

/* ── Composition: Agent detail card ── */

export const AgentDetailCard: Story = {
  name: "Agent Detail Card",
  render: () => (
    <div
      style={{
        maxWidth: 400,
        padding: 20,
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: 8,
      }}
    >
      <h3
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "rgba(0,0,0,0.85)",
          margin: "0 0 16px",
        }}
      >
        Agent Details
      </h3>
      <DetailField label="Name">
        <code style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", fontSize: 13 }}>
          code-reviewer
        </code>
      </DetailField>
      <DetailField label="Status">
        <StatusBadge status="working" size="sm" />
      </DetailField>
      <DetailField label="Model">
        <code style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", fontSize: 12 }}>
          claude-3-opus
        </code>
      </DetailField>
      <DetailField label="Parent">
        <code style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", fontSize: 12 }}>
          orchestrator
        </code>
      </DetailField>
      <DetailField label="Active Quests">3</DetailField>
      <DetailField label="Total Events">142</DetailField>
      <DetailField label="Expertise">
        <TagList items={["typescript", "react", "code-review"]} />
      </DetailField>
      <DetailField label="Created">2026-04-10 09:15 UTC</DetailField>
    </div>
  ),
};

/* ── Composition: Quest detail card ── */

export const QuestDetailCard: Story = {
  name: "Quest Detail Card",
  render: () => (
    <div
      style={{
        maxWidth: 400,
        padding: 20,
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: 8,
      }}
    >
      <h3
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "rgba(0,0,0,0.85)",
          margin: "0 0 16px",
        }}
      >
        Quest Details
      </h3>
      <DetailField label="Title">Refactor auth module</DetailField>
      <DetailField label="Status">
        <StatusBadge status="in_progress" size="sm" />
      </DetailField>
      <DetailField label="Assigned Agent">
        <code style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", fontSize: 12 }}>
          code-reviewer
        </code>
      </DetailField>
      <DetailField label="Description">
        Extract JWT validation into a shared middleware. Update all route handlers to use the new
        pattern.
      </DetailField>
      <DetailField label="Worktree">
        <code style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", fontSize: 12 }}>
          /tmp/aeqi/worktrees/quest-8f3a
        </code>
      </DetailField>
      <DetailField label="Created">2026-04-14 16:42 UTC</DetailField>
    </div>
  ),
};
