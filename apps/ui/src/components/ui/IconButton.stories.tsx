import type { Meta, StoryObj } from "@storybook/react";
import { IconButton } from "./IconButton";

/* ── Icon set used throughout stories ── */

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="5" y="5" width="9" height="9" rx="1.5" />
      <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 4h10M6 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1M5 4l.8 9a1 1 0 0 0 1 .9h2.4a1 1 0 0 0 1-.9L11 4" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M11 2l3 3-8 8H3v-3z" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const meta: Meta<typeof IconButton> = {
  title: "Primitives/Actions/IconButton",
  component: IconButton,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Icon-only button primitive for dense toolbars, detail panels, and row actions. Requires `aria-label` — an icon without a name is a button nobody can read with assistive tech.",
      },
    },
  },
  argTypes: {
    variant: {
      control: "select",
      options: ["ghost", "bordered", "danger"],
    },
    size: {
      control: "select",
      options: ["xs", "sm", "md"],
    },
  },
  args: {
    "aria-label": "Example action",
    children: <CloseIcon />,
  },
};

export default meta;
type Story = StoryObj<typeof IconButton>;

/* ── Individual variants ── */

export const Ghost: Story = {
  args: { variant: "ghost", "aria-label": "Close panel", children: <CloseIcon /> },
};

export const Bordered: Story = {
  args: { variant: "bordered", "aria-label": "Copy value", children: <CopyIcon /> },
};

export const Danger: Story = {
  args: { variant: "danger", "aria-label": "Delete", children: <TrashIcon /> },
};

/* ── Sizes ── */

export const AllSizes: Story = {
  name: "Size Scale",
  render: (args) => (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <IconButton {...args} size="xs" aria-label="Close (xs)">
        <CloseIcon />
      </IconButton>
      <IconButton {...args} size="sm" aria-label="Close (sm)">
        <CloseIcon />
      </IconButton>
      <IconButton {...args} size="md" aria-label="Close (md)">
        <CloseIcon />
      </IconButton>
    </div>
  ),
};

/* ── States ── */

export const Disabled: Story = {
  args: { disabled: true, "aria-label": "Delete", children: <TrashIcon /> },
};

/* ── Composition: Detail panel header ── */

export const DetailHeader: Story = {
  name: "Detail Panel Header",
  render: () => (
    <div
      style={{
        width: 320,
        padding: "12px 14px",
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: 8,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <code style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600 }}>
        onboarding-skill
      </code>
      <IconButton aria-label="Close detail">
        <CloseIcon />
      </IconButton>
    </div>
  ),
};

/* ── Composition: Row action cluster ── */

export const RowActions: Story = {
  name: "Row Action Cluster",
  render: () => (
    <div
      style={{
        width: 360,
        padding: "10px 12px",
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: 8,
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <span style={{ flex: 1, fontSize: 13 }}>quest-42 · Ship the rebrand</span>
      <IconButton size="xs" aria-label="Edit quest">
        <EditIcon />
      </IconButton>
      <IconButton size="xs" variant="danger" aria-label="Delete quest">
        <TrashIcon />
      </IconButton>
      <IconButton size="xs" aria-label="Open quest">
        <ChevronIcon />
      </IconButton>
    </div>
  ),
};

/* ── Composition: Copy-to-clipboard (bordered) ── */

export const CopyField: Story = {
  name: "Copy Field",
  render: () => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: 4,
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: 6,
        width: 320,
      }}
    >
      <code
        style={{
          flex: 1,
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          padding: "0 8px",
          color: "rgba(0,0,0,0.7)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        sk-aeqi-7f3c9d2b8a0e1f4c5d6e7f8a9b0c1d2e
      </code>
      <IconButton variant="bordered" aria-label="Copy secret">
        <CopyIcon />
      </IconButton>
    </div>
  ),
};
