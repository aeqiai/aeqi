import type { Meta, StoryObj } from "@storybook/react";
import { ChipClose } from "./ChipClose";

const meta: Meta<typeof ChipClose> = {
  title: "Primitives/Actions/ChipClose",
  component: ChipClose,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Icon-only close button primitive for inline use within chips, tags, and badges. Renders a small stroked × icon with ghost styling. Requires `label` prop to ensure the remove action is accessible.",
      },
    },
  },
  argTypes: {
    label: {
      control: "text",
      description: "Accessible label describing what will be removed",
    },
  },
  args: {
    label: "Remove tag",
  },
};

export default meta;
type Story = StoryObj<typeof ChipClose>;

/* ── Default ── */

export const Default: Story = {
  args: {
    label: "Remove tag",
  },
};

/* ── States ── */

export const Disabled: Story = {
  args: {
    label: "Remove tag",
    disabled: true,
  },
};

/* ── Composition: Tag with close ── */

export const InTag: Story = {
  name: "Inside Tag",
  render: (args) => (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 8px",
        backgroundColor: "var(--input-bg)",
        border: "1px solid var(--input-border)",
        borderRadius: "var(--radius-md)",
        fontSize: 13,
      }}
    >
      <span>important</span>
      <ChipClose {...args} label="Remove tag important" />
    </div>
  ),
};

/* ── Composition: Badge with close ── */

export const InBadge: Story = {
  name: "Inside Badge",
  render: (args) => (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 6px",
        backgroundColor: "var(--color-accent-bg)",
        color: "var(--color-accent)",
        borderRadius: "999px",
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      <span>3 refs</span>
      <ChipClose {...args} label="Remove reference" />
    </div>
  ),
};

/* ── Composition: Attachment chip ── */

export const InAttachmentChip: Story = {
  name: "Inside Attachment Chip",
  render: (args) => (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        backgroundColor: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "var(--radius-sm)",
        fontSize: 12,
      }}
    >
      <span>document.pdf</span>
      <ChipClose {...args} label="Remove attachment document.pdf" />
    </div>
  ),
};
