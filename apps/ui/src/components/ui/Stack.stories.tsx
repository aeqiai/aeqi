import type { Meta, StoryObj } from "@storybook/react";
import { Stack } from "./Stack";
import { Inline } from "./Inline";
import type { SpaceToken } from "./Stack";

const meta: Meta<typeof Stack> = {
  title: "Primitives/Containers/Stack",
  component: Stack,
  tags: ["autodocs"],
  argTypes: {
    gap: {
      control: "select",
      options: ["0", "1", "2", "3", "4", "5", "6", "8"],
    },
    align: {
      control: "select",
      options: ["start", "center", "end", "stretch"],
    },
    as: {
      control: "select",
      options: ["div", "section", "ul", "ol", "li", "nav", "main", "aside", "article"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Stack>;

/* ── Shared demo child ── */

function Box({ label, wide }: { label?: string; wide?: boolean }) {
  return (
    <div
      style={{
        padding: "10px 16px",
        background: "var(--color-slab)",
        borderRadius: "var(--radius-sm)",
        fontSize: "var(--font-size-sm)",
        color: "var(--color-text-secondary)",
        fontFamily: "var(--font-sans)",
        width: wide ? "100%" : undefined,
      }}
    >
      {label ?? "child"}
    </div>
  );
}

/* ── Stories ── */

export const Default: Story = {
  render: () => (
    <Stack>
      <Box label="first" />
      <Box label="second" />
      <Box label="third" />
    </Stack>
  ),
};

export const GapScale: Story = {
  name: "Gap Scale",
  render: () => {
    const gaps: SpaceToken[] = ["1", "2", "3", "4", "5", "6", "8"];
    return (
      <div style={{ display: "flex", gap: 32, alignItems: "flex-start" }}>
        {gaps.map((gap) => (
          <div key={gap}>
            <p
              style={{
                fontSize: "var(--font-size-xs)",
                color: "var(--color-text-muted)",
                fontFamily: "var(--font-sans)",
                marginBottom: 8,
              }}
            >
              gap=&quot;{gap}&quot;
            </p>
            <Stack gap={gap}>
              <Box />
              <Box />
              <Box />
            </Stack>
          </div>
        ))}
      </div>
    );
  },
};

export const AlignmentVariants: Story = {
  name: "Alignment Variants",
  render: () => {
    const aligns = ["start", "center", "end", "stretch"] as const;
    return (
      <div style={{ display: "flex", gap: 32, alignItems: "flex-start" }}>
        {aligns.map((align) => (
          <div key={align} style={{ width: 140 }}>
            <p
              style={{
                fontSize: "var(--font-size-xs)",
                color: "var(--color-text-muted)",
                fontFamily: "var(--font-sans)",
                marginBottom: 8,
              }}
            >
              align=&quot;{align}&quot;
            </p>
            <Stack
              align={align}
              style={{
                background: "var(--color-slab-elevated)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-md)",
                padding: "var(--space-3)",
              }}
            >
              <Box label="short" />
              <Box label="longer label" />
              <Box label="md" />
            </Stack>
          </div>
        ))}
      </div>
    );
  },
};

export const As: Story = {
  name: "Polymorphic — as ul",
  render: () => (
    <Stack as="ul" gap="2" style={{ listStyle: "none", padding: 0, margin: 0, maxWidth: 280 }}>
      <li
        style={{
          padding: "var(--space-2) var(--space-3)",
          background: "var(--color-slab)",
          borderRadius: "var(--radius-sm)",
          fontSize: "var(--font-size-sm)",
          color: "var(--color-text-primary)",
        }}
      >
        Research Lead
      </li>
      <li
        style={{
          padding: "var(--space-2) var(--space-3)",
          background: "var(--color-slab)",
          borderRadius: "var(--radius-sm)",
          fontSize: "var(--font-size-sm)",
          color: "var(--color-text-primary)",
        }}
      >
        Ops Janitor
      </li>
      <li
        style={{
          padding: "var(--space-2) var(--space-3)",
          background: "var(--color-slab)",
          borderRadius: "var(--radius-sm)",
          fontSize: "var(--font-size-sm)",
          color: "var(--color-text-primary)",
        }}
      >
        Founder Voice
      </li>
    </Stack>
  ),
};

export const RealUseCase: Story = {
  name: "Real Use Case — Form",
  render: () => (
    <div
      style={{
        maxWidth: 360,
        padding: "var(--space-6)",
        background: "var(--color-card)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-lg)",
      }}
    >
      <p
        style={{
          fontSize: "var(--font-size-lg)",
          fontWeight: "var(--font-weight-semibold)",
          color: "var(--color-text-title)",
          marginBottom: "var(--space-5)",
        }}
      >
        Create Agent
      </p>
      <Stack gap="4">
        {/* Label + input row */}
        <Stack gap="1">
          <label
            style={{
              fontSize: "var(--font-size-xs)",
              fontWeight: "var(--font-weight-medium)",
              color: "var(--color-text-secondary)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Name
          </label>
          <div
            style={{
              height: "var(--input-h, 32px)",
              background: "var(--color-slab)",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--color-border)",
            }}
          />
        </Stack>

        {/* Label + textarea row */}
        <Stack gap="1">
          <label
            style={{
              fontSize: "var(--font-size-xs)",
              fontWeight: "var(--font-weight-medium)",
              color: "var(--color-text-secondary)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Description
          </label>
          <div
            style={{
              height: 72,
              background: "var(--color-slab)",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--color-border)",
            }}
          />
        </Stack>

        {/* Button bar */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "var(--space-2)",
            paddingTop: "var(--space-2)",
            borderTop: "1px solid var(--color-border)",
          }}
        >
          <div
            style={{
              padding: "0 var(--space-4)",
              height: "var(--input-h, 32px)",
              background: "var(--color-slab)",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--color-border)",
              display: "flex",
              alignItems: "center",
              fontSize: "var(--font-size-sm)",
              color: "var(--color-text-primary)",
            }}
          >
            Cancel
          </div>
          <div
            style={{
              padding: "0 var(--space-4)",
              height: "var(--input-h, 32px)",
              background: "var(--color-accent)",
              borderRadius: "var(--radius-md)",
              display: "flex",
              alignItems: "center",
              fontSize: "var(--font-size-sm)",
              color: "var(--color-text-on-accent)",
            }}
          >
            Create Agent
          </div>
        </div>
      </Stack>
    </div>
  ),
};

export const RealComposition: Story = {
  name: "Real Composition — Agent Details",
  parameters: {
    docs: {
      description: {
        story:
          "Demonstrates Stack + Inline composition: a vertical stack of horizontal label-value pairs. Canonical pattern for agent detail views, quest summaries, and read-only property lists. Consistent vertical rhythm with horizontal alignment.",
      },
    },
  },
  render: () => (
    <div
      style={{
        maxWidth: 420,
        padding: "var(--space-5)",
        background: "var(--color-card)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-lg)",
      }}
    >
      <p
        style={{
          fontSize: "var(--font-size-lg)",
          fontWeight: "var(--font-weight-semibold)",
          color: "var(--color-text-title)",
          marginBottom: "var(--space-4)",
        }}
      >
        Research Lead
      </p>
      <Stack gap="3">
        {/* Row: Label + Value */}
        <Inline justify="between" align="center">
          <span
            style={{
              fontSize: "var(--font-size-xs)",
              fontWeight: "var(--font-weight-medium)",
              color: "var(--color-text-secondary)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Status
          </span>
          <span
            style={{
              padding: "3px 8px",
              fontSize: "var(--font-size-xs)",
              fontWeight: "var(--font-weight-medium)",
              color: "var(--color-success)",
              background: "var(--color-success-bg)",
              border: "1px solid var(--color-success-border)",
              borderRadius: "var(--radius-full)",
            }}
          >
            active
          </span>
        </Inline>

        {/* Row: Label + Value */}
        <Inline justify="between" align="center">
          <span
            style={{
              fontSize: "var(--font-size-xs)",
              fontWeight: "var(--font-weight-medium)",
              color: "var(--color-text-secondary)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Scope
          </span>
          <span
            style={{
              fontSize: "var(--font-size-sm)",
              color: "var(--color-text-primary)",
            }}
          >
            Company Root
          </span>
        </Inline>

        {/* Row: Label + Value */}
        <Inline justify="between" align="center">
          <span
            style={{
              fontSize: "var(--font-size-xs)",
              fontWeight: "var(--font-weight-medium)",
              color: "var(--color-text-secondary)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Created
          </span>
          <span
            style={{
              fontSize: "var(--font-size-sm)",
              color: "var(--color-text-primary)",
            }}
          >
            Nov 28, 2025
          </span>
        </Inline>

        {/* Row: Label + Value */}
        <Inline justify="between" align="center">
          <span
            style={{
              fontSize: "var(--font-size-xs)",
              fontWeight: "var(--font-weight-medium)",
              color: "var(--color-text-secondary)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Sessions
          </span>
          <span
            style={{
              fontSize: "var(--font-size-sm)",
              color: "var(--color-text-primary)",
              fontWeight: "var(--font-weight-semibold)",
            }}
          >
            42
          </span>
        </Inline>

        {/* Row: Label + Value */}
        <Inline justify="between" align="center">
          <span
            style={{
              fontSize: "var(--font-size-xs)",
              fontWeight: "var(--font-weight-medium)",
              color: "var(--color-text-secondary)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Current Quest
          </span>
          <span
            style={{
              fontSize: "var(--font-size-sm)",
              color: "var(--color-text-primary)",
            }}
          >
            Market Analysis
          </span>
        </Inline>
      </Stack>
    </div>
  ),
};
