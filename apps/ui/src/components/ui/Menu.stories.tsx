import type { Meta, StoryObj } from "@storybook/react";
import { Menu } from "./Menu";
import { IconButton } from "./IconButton";
import { Button } from "./Button";

const KebabIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    <circle cx="3" cy="8" r="1.4" />
    <circle cx="8" cy="8" r="1.4" />
    <circle cx="13" cy="8" r="1.4" />
  </svg>
);

const EditIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    aria-hidden
  >
    <path d="M11 2l3 3-9 9H2v-3l9-9z" />
  </svg>
);

const TrashIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    aria-hidden
  >
    <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 10h8l1-10" />
  </svg>
);

const meta: Meta<typeof Menu> = {
  title: "Primitives/Actions/Menu",
  component: Menu,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
};

export default meta;
type Story = StoryObj<typeof Menu>;

/** Basic action list, no icons. */
export const Basic: Story = {
  render: () => (
    <div style={{ padding: 40 }}>
      <Menu
        trigger={
          <IconButton aria-label="More actions">
            <KebabIcon />
          </IconButton>
        }
        items={[
          { key: "view", label: "View", onSelect: () => alert("View") },
          { key: "edit", label: "Edit", onSelect: () => alert("Edit") },
          { key: "duplicate", label: "Duplicate", onSelect: () => alert("Duplicate") },
        ]}
        placement="bottom-end"
      />
    </div>
  ),
};

/** Items with leading icons. */
export const WithIcons: Story = {
  render: () => (
    <div style={{ padding: 40 }}>
      <Menu
        trigger={
          <IconButton aria-label="More actions">
            <KebabIcon />
          </IconButton>
        }
        items={[
          { key: "edit", label: "Edit", icon: <EditIcon />, onSelect: () => alert("Edit") },
          {
            key: "delete",
            label: "Delete",
            icon: <TrashIcon />,
            destructive: true,
            onSelect: () => alert("Delete"),
          },
        ]}
        placement="bottom-end"
      />
    </div>
  ),
};

/** Destructive item with two-step confirm guard. */
export const DestructiveWithConfirm: Story = {
  render: () => (
    <div style={{ padding: 40 }}>
      <Menu
        trigger={
          <IconButton aria-label="More actions">
            <KebabIcon />
          </IconButton>
        }
        items={[
          { key: "edit", label: "Edit", onSelect: () => alert("Edit") },
          {
            key: "delete",
            label: "Delete",
            destructive: true,
            confirmLabel: "Confirm delete?",
            onSelect: () => alert("Deleted!"),
          },
        ]}
        placement="bottom-end"
      />
    </div>
  ),
};

/** All items disabled. */
export const AllDisabled: Story = {
  render: () => (
    <div style={{ padding: 40 }}>
      <Menu
        trigger={
          <IconButton aria-label="More actions">
            <KebabIcon />
          </IconButton>
        }
        items={[
          { key: "edit", label: "Edit", disabled: true, onSelect: () => {} },
          { key: "delete", label: "Delete", disabled: true, destructive: true, onSelect: () => {} },
        ]}
        placement="bottom-end"
      />
    </div>
  ),
};

/** Custom trigger — plain Button instead of IconButton. */
export const CustomTrigger: Story = {
  render: () => (
    <div style={{ padding: 40 }}>
      <Menu
        trigger={<Button variant="secondary">Actions ▾</Button>}
        items={[
          { key: "export", label: "Export", onSelect: () => alert("Export") },
          { key: "archive", label: "Archive", onSelect: () => alert("Archive") },
          {
            key: "delete",
            label: "Delete",
            destructive: true,
            confirmLabel: "Really delete?",
            onSelect: () => alert("Deleted"),
          },
        ]}
        placement="bottom-start"
      />
    </div>
  ),
};
