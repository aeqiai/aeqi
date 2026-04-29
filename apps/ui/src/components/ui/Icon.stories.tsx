import type { Meta, StoryObj } from "@storybook/react";
import {
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  ArrowRight,
  CircleCheck,
  CircleAlert,
  Loader2,
  Info,
  Search,
  Filter,
  Settings,
  ExternalLink,
} from "lucide-react";
import { Icon } from "./Icon";

const meta: Meta<typeof Icon> = {
  title: "Primitives/Data Display/Icon",
  component: Icon,
  tags: ["autodocs"],
  argTypes: {
    size: {
      control: "select",
      options: ["xs", "sm", "md", "lg"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Icon>;

/* ── Default ── */

export const Default: Story = {
  args: { icon: Plus, size: "md" },
};

/* ── Size scale ── */

export const SizeScale: Story = {
  name: "Size Scale",
  render: () => (
    <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
      {(["xs", "sm", "md", "lg"] as const).map((size) => (
        <div
          key={size}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Icon icon={Plus} size={size} />
          <span
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "var(--font-size-2xs)",
              color: "var(--color-text-muted)",
            }}
          >
            {size}
          </span>
        </div>
      ))}
    </div>
  ),
};

/* ── With label (non-decorative) ── */

export const WithLabel: Story = {
  name: "With Label",
  render: () => (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Icon icon={X} size="md" decorative={false} label="Close dialog" />
      <span
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "var(--font-size-xs)",
          color: "var(--color-text-secondary)",
        }}
      >
        role=&quot;img&quot; aria-label=&quot;Close dialog&quot;
      </span>
    </div>
  ),
};

/* ── On ink surface ── */

export const OnInkSurface: Story = {
  name: "On Ink Surface",
  render: () => (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        background: "var(--color-ink-card)",
        borderRadius: "var(--radius-md)",
        color: "var(--color-ink-card-text)",
      }}
    >
      <Icon icon={Search} size="sm" />
      <Icon icon={Plus} size="sm" />
      <Icon icon={Settings} size="sm" />
      <Icon icon={X} size="sm" />
    </div>
  ),
};

/* ── Common icons grid ── */

const ICON_GROUPS: {
  label: string;
  icons: { icon: React.ComponentType<React.SVGAttributes<SVGSVGElement>>; name: string }[];
}[] = [
  {
    label: "Action",
    icons: [
      { icon: Plus, name: "Plus" },
      { icon: Trash2, name: "Trash2" },
      { icon: Pencil, name: "Pencil" },
      { icon: Check, name: "Check" },
      { icon: X, name: "X" },
    ],
  },
  {
    label: "Navigation",
    icons: [
      { icon: ChevronDown, name: "ChevronDown" },
      { icon: ChevronRight, name: "ChevronRight" },
      { icon: ArrowLeft, name: "ArrowLeft" },
      { icon: ArrowRight, name: "ArrowRight" },
    ],
  },
  {
    label: "Status",
    icons: [
      { icon: CircleCheck, name: "CircleCheck" },
      { icon: CircleAlert, name: "CircleAlert" },
      { icon: Loader2, name: "Loader2" },
      { icon: Info, name: "Info" },
    ],
  },
  {
    label: "Content",
    icons: [
      { icon: Search, name: "Search" },
      { icon: Filter, name: "Filter" },
      { icon: Settings, name: "Settings" },
      { icon: ExternalLink, name: "ExternalLink" },
    ],
  },
];

export const CommonIcons: Story = {
  name: "Common Icons",
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {ICON_GROUPS.map((group) => (
        <div key={group.label}>
          <p
            style={{
              fontSize: "var(--font-size-xs)",
              color: "var(--color-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              margin: "0 0 12px",
              fontFamily: "var(--font-sans)",
            }}
          >
            {group.label}
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 80px)",
              gap: 8,
            }}
          >
            {group.icons.map(({ icon, name }) => (
              <div
                key={name}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                  padding: "10px 4px",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-sm)",
                }}
              >
                <Icon icon={icon as Parameters<typeof Icon>[0]["icon"]} size="md" />
                <span
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: "var(--font-size-2xs)",
                    color: "var(--color-text-muted)",
                    textAlign: "center",
                    wordBreak: "break-word",
                  }}
                >
                  {name}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  ),
};

/* ── Icon wrapper purpose ── */

export const WhyUseIconWrapper: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "The Icon wrapper exists to unify decorative vs functional icon usage, enforce consistent sizing across the design system, and provide accessibility hooks. Use <Icon icon={Plus} /> for all icons in components; avoid importing icons directly unless you need custom stroke width or animation. This ensures: (1) a11y bifurcation via the decorative prop (sets role=img + aria-label for functional icons), (2) consistent size scale (xs/sm/md/lg map to the token-defined pixel values), and (3) a single transition contract for hover/focus states. Direct icon imports bypass these guarantees and fragment the visual contract.",
      },
    },
  },
  render: () => (
    <div style={{ display: "flex", gap: 32, alignItems: "flex-start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p style={{ fontSize: 12, fontWeight: 600, color: "rgba(0,0,0,0.6)", margin: 0 }}>
          Recommended: Icon wrapper
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Icon icon={Plus} size="md" decorative={false} label="Add new quest" />
          <span style={{ fontSize: 13, color: "rgba(0,0,0,0.6)" }}>Functional (a11y label)</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Icon icon={Plus} size="md" />
          <span style={{ fontSize: 13, color: "rgba(0,0,0,0.6)" }}>Decorative</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p style={{ fontSize: 12, fontWeight: 600, color: "rgba(0,0,0,0.6)", margin: 0 }}>
          Direct import (avoid unless needed)
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Plus size={16} />
          <span style={{ fontSize: 13, color: "rgba(0,0,0,0.4)" }}>
            No a11y hooks, manual sizing
          </span>
        </div>
      </div>
    </div>
  ),
};
