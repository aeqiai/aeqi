import type { Meta, StoryObj } from "@storybook/react";
import { Card, CardHeader, CardFooter } from "./Card";
import { Button } from "./Button";
import { Badge, StatusBadge } from "./Badge";

const meta: Meta<typeof Card> = {
  title: "Primitives/Containers/Card",
  component: Card,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Container primitive for grouped content. Compose with `CardHeader` / `CardFooter` for structured layouts, or use standalone with `padding` for lightweight surfaces.",
      },
    },
  },
  argTypes: {
    variant: { control: "select", options: ["default", "surface", "flat"] },
    padding: { control: "select", options: ["none", "sm", "md", "lg"] },
    interactive: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof Card>;

/* ── Variants ── */

export const Default: Story = {
  args: {
    variant: "default",
    padding: "md",
    children: (
      <>
        <h4 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 600 }}>Default card</h4>
        <p style={{ margin: 0, fontSize: 13, color: "rgba(0,0,0,0.6)" }}>
          Standard surface over the base background.
        </p>
      </>
    ),
  },
};

export const Surface: Story = {
  args: {
    variant: "surface",
    padding: "md",
    children: (
      <>
        <h4 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 600 }}>Surface card</h4>
        <p style={{ margin: 0, fontSize: 13, color: "rgba(0,0,0,0.6)" }}>
          Nested surface — sits on a bg-surface parent.
        </p>
      </>
    ),
  },
};

export const Flat: Story = {
  args: {
    variant: "flat",
    padding: "md",
    children: (
      <>
        <h4 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 600 }}>Flat card</h4>
        <p style={{ margin: 0, fontSize: 13, color: "rgba(0,0,0,0.6)" }}>
          Transparent container — border only, no background fill.
        </p>
      </>
    ),
  },
};

export const Interactive: Story = {
  args: {
    interactive: true,
    padding: "md",
    onClick: () => {},
    children: (
      <>
        <h4 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 600 }}>Interactive card</h4>
        <p style={{ margin: 0, fontSize: 13, color: "rgba(0,0,0,0.6)" }}>
          Hover/focus lift — use for clickable rows and tiles.
        </p>
      </>
    ),
  },
};

/* ── Composition: Agent summary ── */

export const AgentSummary: Story = {
  name: "Agent Summary",
  render: () => (
    <div style={{ maxWidth: 360 }}>
      <Card padding="none">
        <CardHeader title="code-reviewer" actions={<StatusBadge status="active" />} />
        <div style={{ padding: "12px 16px", fontSize: 13, color: "rgba(0,0,0,0.7)" }}>
          Reviews pull requests for the aeqi monorepo. Escalates high-risk changes to the CTO agent.
        </div>
        <CardFooter>
          <span style={{ fontSize: 12, color: "rgba(0,0,0,0.4)" }}>
            claude-opus-4 · child of cto
          </span>
          <div style={{ flex: 1 }} />
          <Button variant="ghost" size="sm">
            View
          </Button>
        </CardFooter>
      </Card>
    </div>
  ),
};

/* ── Composition: Quest card ── */

export const QuestCard: Story = {
  name: "Quest Card",
  render: () => (
    <div style={{ maxWidth: 400 }}>
      <Card padding="none" interactive>
        <CardHeader
          title={
            <span style={{ fontFamily: "var(--font-sans)", fontSize: 12 }}>
              QST-042 · Migrate payments SDK
            </span>
          }
          actions={<Badge variant="warning">high</Badge>}
        />
        <div style={{ padding: "8px 16px 14px", fontSize: 13, color: "rgba(0,0,0,0.65)" }}>
          Swap the deprecated payments client for the new SDK. Remove old dependency once tests
          pass.
        </div>
        <CardFooter>
          <StatusBadge status="in_progress" />
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: "rgba(0,0,0,0.35)" }}>@payments-agent · 2h ago</span>
        </CardFooter>
      </Card>
    </div>
  ),
};

/* ── Composition: Stat tiles ── */

export const StatTiles: Story = {
  name: "Stat Tiles",
  render: () => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, maxWidth: 600 }}>
      <Card variant="flat" padding="md">
        <div style={{ fontSize: 11, color: "rgba(0,0,0,0.4)", textTransform: "uppercase" }}>
          Active agents
        </div>
        <div
          style={{
            fontSize: 24,
            fontWeight: 600,
            marginTop: 4,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          12
        </div>
      </Card>
      <Card variant="flat" padding="md">
        <div style={{ fontSize: 11, color: "rgba(0,0,0,0.4)", textTransform: "uppercase" }}>
          In-progress
        </div>
        <div
          style={{
            fontSize: 24,
            fontWeight: 600,
            marginTop: 4,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          4
        </div>
      </Card>
      <Card variant="flat" padding="md">
        <div style={{ fontSize: 11, color: "rgba(0,0,0,0.4)", textTransform: "uppercase" }}>
          Cost / day
        </div>
        <div
          style={{
            fontSize: 24,
            fontWeight: 600,
            marginTop: 4,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          $3.42
        </div>
      </Card>
    </div>
  ),
};

/* ── Composition: Structured panel with header and footer ── */

export const WithHeaderAndFooter: Story = {
  name: "With Header and Footer",
  parameters: {
    docs: {
      description: {
        story:
          "Canonical structured panel pattern: Card with padding='none' houses CardHeader (title + actions), manual-padding body content, and CardFooter with action row. Used for dialogs, detail panes, and form containers.",
      },
    },
  },
  render: () => (
    <div style={{ maxWidth: 420 }}>
      <Card padding="none">
        <CardHeader title="Edit quest parameters" actions={<Badge variant="info">PRD-187</Badge>} />
        <div style={{ padding: "16px", fontSize: 13, color: "rgba(0,0,0,0.65)" }}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
              Title
            </label>
            <div
              style={{
                padding: "8px 12px",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-md)",
                fontSize: 13,
              }}
            >
              Refactor authentication module
            </div>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
              Assigned agent
            </label>
            <div
              style={{
                padding: "8px 12px",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-md)",
                fontSize: 13,
              }}
            >
              code-reviewer
            </div>
          </div>
        </div>
        <CardFooter>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="secondary" size="sm">
              Cancel
            </Button>
            <Button variant="primary" size="sm">
              Save
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  ),
};

/* ── Composition: Flat list of cards ── */

export const FlatList: Story = {
  name: "Flat List",
  parameters: {
    docs: {
      description: {
        story:
          "Flat-variant cards stacked as a list, no outer padding. Content rows separated by spacing, no dividers. Demonstrates the flat variant for list-like surfaces and quest rows.",
      },
    },
  },
  render: () => (
    <div style={{ maxWidth: 420 }}>
      <Card variant="flat" padding="none">
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {["QST-042: Migrate SDK", "QST-039: Add test coverage", "QST-035: Refactor parser"].map(
            (title, idx) => (
              <div
                key={idx}
                style={{
                  padding: "12px 16px",
                  borderBottom: idx < 2 ? "1px solid rgba(0,0,0,0.06)" : undefined,
                  fontSize: 13,
                }}
              >
                <div style={{ fontWeight: 500, marginBottom: 4 }}>{title}</div>
                <div style={{ fontSize: 12, color: "rgba(0,0,0,0.55)" }}>
                  @code-reviewer · in progress
                </div>
              </div>
            ),
          )}
        </div>
      </Card>
    </div>
  ),
};

/* ── Composition: Nested surface hierarchy ── */

export const NestedSurface: Story = {
  name: "Nested Surface",
  parameters: {
    docs: {
      description: {
        story:
          "Surface-variant Card containing a default-variant Card, demonstrating nesting hierarchy and how surfaces stack for visual separation and grouping.",
      },
    },
  },
  render: () => (
    <div style={{ maxWidth: 420, padding: 20, background: "var(--color-bg-surface)" }}>
      <Card variant="surface" padding="md">
        <h4 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600 }}>Workspace settings</h4>
        <div style={{ marginBottom: 16, fontSize: 13, color: "rgba(0,0,0,0.6)" }}>
          Configure team permissions and workspace behavior.
        </div>
        <Card variant="default" padding="md">
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Member limit</div>
            <div style={{ fontSize: 13, color: "rgba(0,0,0,0.65)" }}>
              Up to 50 agents per company
            </div>
          </div>
        </Card>
      </Card>
    </div>
  ),
};
