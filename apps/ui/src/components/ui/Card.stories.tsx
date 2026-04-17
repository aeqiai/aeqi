import type { Meta, StoryObj } from "@storybook/react";
import { Card, CardHeader, CardFooter } from "./Card";
import { Button } from "./Button";
import { Badge, StatusBadge } from "./Badge";

const meta: Meta<typeof Card> = {
  title: "Components/Card",
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
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
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
