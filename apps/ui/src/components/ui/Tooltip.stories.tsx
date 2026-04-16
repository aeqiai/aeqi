import type { Meta, StoryObj } from "@storybook/react";
import { Tooltip } from "./Tooltip";
import { Button } from "./Button";
import { Badge } from "./Badge";

const meta: Meta<typeof Tooltip> = {
  title: "Components/Tooltip",
  component: Tooltip,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <div style={{ padding: 80 }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Tooltip>;

/* ── Positions ── */

export const Top: Story = {
  args: {
    content: "View agent details",
    position: "top",
    children: <Button variant="secondary">Hover me</Button>,
  },
};

export const Bottom: Story = {
  args: {
    content: "Open event stream",
    position: "bottom",
    children: <Button variant="secondary">Hover me</Button>,
  },
};

export const Left: Story = {
  args: {
    content: "Previous quest",
    position: "left",
    children: <Button variant="ghost">Hover me</Button>,
  },
};

export const Right: Story = {
  args: {
    content: "Next quest",
    position: "right",
    children: <Button variant="ghost">Hover me</Button>,
  },
};

/* ── Contextual usage: toolbar with tooltips ── */

export const ToolbarWithTooltips: Story = {
  name: "Toolbar with Tooltips",
  render: () => (
    <div
      style={{
        display: "flex",
        gap: 4,
        padding: "8px 12px",
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: 8,
      }}
    >
      <Tooltip content="New quest" position="bottom">
        <Button variant="ghost" size="sm">
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M7 1v12M1 7h12" />
          </svg>
        </Button>
      </Tooltip>
      <Tooltip content="Refresh agents" position="bottom">
        <Button variant="ghost" size="sm">
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M1 7a6 6 0 0111.196-3M13 7A6 6 0 011.804 10" />
          </svg>
        </Button>
      </Tooltip>
      <Tooltip content="View event log" position="bottom">
        <Button variant="ghost" size="sm">
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <rect x="1" y="1" width="12" height="12" rx="2" />
            <path d="M4 5h6M4 7.5h4M4 10h5" />
          </svg>
        </Button>
      </Tooltip>
    </div>
  ),
};

/* ── Tooltip on badges ── */

export const BadgeTooltip: Story = {
  name: "Tooltip on Badge",
  render: () => (
    <Tooltip content="Agent has been working for 2h 34m" position="top">
      <span>
        <Badge variant="accent" dot>
          Working
        </Badge>
      </span>
    </Tooltip>
  ),
};
