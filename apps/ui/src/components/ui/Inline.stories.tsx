import type { Meta, StoryObj } from "@storybook/react";
import { Inline } from "./Inline";
import type { SpaceToken } from "./Stack";

const meta: Meta<typeof Inline> = {
  title: "Primitives/Containers/Inline",
  component: Inline,
  tags: ["autodocs"],
  argTypes: {
    gap: {
      control: "select",
      options: ["0", "1", "2", "3", "4", "5", "6", "8"],
    },
    align: {
      control: "select",
      options: ["start", "center", "end", "baseline", "stretch"],
    },
    justify: {
      control: "select",
      options: ["start", "center", "end", "between", "around"],
    },
    wrap: { control: "boolean" },
    as: {
      control: "select",
      options: ["div", "section", "ul", "ol", "li", "nav", "header", "footer"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Inline>;

/* ── Shared demo child ── */

function Chip({ label }: { label: string }) {
  return (
    <div
      style={{
        padding: "6px 12px",
        background: "var(--color-slab)",
        borderRadius: "var(--radius-sm)",
        fontSize: "var(--font-size-sm)",
        color: "var(--color-text-secondary)",
        fontFamily: "var(--font-sans)",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </div>
  );
}

function TallChip({ label, height }: { label: string; height: number }) {
  return (
    <div
      style={{
        padding: "6px 12px",
        height,
        background: "var(--color-slab)",
        borderRadius: "var(--radius-sm)",
        fontSize: "var(--font-size-sm)",
        color: "var(--color-text-secondary)",
        display: "flex",
        alignItems: "flex-end",
      }}
    >
      {label}
    </div>
  );
}

/* ── Stories ── */

export const Default: Story = {
  render: () => (
    <Inline>
      <Chip label="first" />
      <Chip label="second" />
      <Chip label="third" />
    </Inline>
  ),
};

export const GapScale: Story = {
  name: "Gap Scale",
  render: () => {
    const gaps: SpaceToken[] = ["1", "2", "3", "4", "5", "6", "8"];
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
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
            <Inline gap={gap}>
              <Chip label="alpha" />
              <Chip label="beta" />
              <Chip label="gamma" />
            </Inline>
          </div>
        ))}
      </div>
    );
  },
};

export const Alignment: Story = {
  name: "Alignment Variants",
  render: () => {
    const aligns = ["start", "center", "end", "baseline"] as const;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {aligns.map((align) => (
          <div key={align}>
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
            <Inline
              align={align}
              style={{
                background: "var(--color-slab-elevated)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-md)",
                padding: "var(--space-3)",
                height: 64,
              }}
            >
              <TallChip label="short" height={28} />
              <TallChip label="tall" height={48} />
              <TallChip label="mid" height={36} />
            </Inline>
          </div>
        ))}
      </div>
    );
  },
};

export const Justification: Story = {
  name: "Justification Variants",
  render: () => {
    const justifies = ["start", "between", "end"] as const;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {justifies.map((justify) => (
          <div key={justify}>
            <p
              style={{
                fontSize: "var(--font-size-xs)",
                color: "var(--color-text-muted)",
                fontFamily: "var(--font-sans)",
                marginBottom: 8,
              }}
            >
              justify=&quot;{justify}&quot;
            </p>
            <Inline
              justify={justify}
              style={{
                background: "var(--color-slab-elevated)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-md)",
                padding: "var(--space-3)",
              }}
            >
              <Chip label="alpha" />
              <Chip label="beta" />
              <Chip label="gamma" />
            </Inline>
          </div>
        ))}
      </div>
    );
  },
};

export const Wrap: Story = {
  name: "Wrap",
  render: () => (
    <div style={{ maxWidth: 360 }}>
      <Inline wrap gap="2">
        {["research", "summarisation", "drafting", "analysis", "fact-check", "translation"].map(
          (tag) => (
            <Chip key={tag} label={tag} />
          ),
        )}
      </Inline>
    </div>
  ),
};

export const RealUseCase: Story = {
  name: "Real Use Case — Card Header",
  render: () => (
    <div
      style={{
        width: 420,
        padding: "var(--space-4) var(--space-5)",
        background: "var(--color-card)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-lg)",
      }}
    >
      <Inline justify="between" align="center">
        {/* Left: agent name */}
        <span
          style={{
            fontSize: "var(--font-size-base)",
            fontWeight: "var(--font-weight-semibold)",
            color: "var(--color-text-title)",
          }}
        >
          Research Lead
        </span>

        {/* Right: badge + icon action */}
        <Inline gap="2" align="center">
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
          <div
            style={{
              width: 28,
              height: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "var(--radius-md)",
              background: "var(--color-slab)",
              color: "var(--color-text-secondary)",
              cursor: "pointer",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="3" cy="7" r="1.2" fill="currentColor" />
              <circle cx="7" cy="7" r="1.2" fill="currentColor" />
              <circle cx="11" cy="7" r="1.2" fill="currentColor" />
            </svg>
          </div>
        </Inline>
      </Inline>
    </div>
  ),
};
