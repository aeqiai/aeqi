import type { Meta, StoryObj } from "@storybook/react";
import { Tooltip } from "./Tooltip";
import { Button } from "./Button";
import { Badge } from "./Badge";

const meta: Meta<typeof Tooltip> = {
  title: "Primitives/Overlays/Tooltip",
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

/* ── Keyboard focus accessibility ── */

export const KeyboardFocus: Story = {
  name: "Keyboard Focus",
  render: () => (
    <Tooltip content="View full agent transcript" position="bottom">
      <Button variant="secondary">Tab to me</Button>
    </Tooltip>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Tooltip appears on keyboard focus (Tab key) and disappears on blur. Tooltip is keyboard-accessible; not just hover-triggered. Press Tab to focus the button.",
      },
    },
  },
};

/* ── Long text constraint ── */

export const LongText: Story = {
  name: "Long Text",
  args: {
    content:
      "This is a long tooltip text with more than fifty characters to demonstrate the constraint",
    position: "top",
    children: <Button variant="secondary">Long tooltip</Button>,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Tooltip with long content (50+ chars) applies white-space: nowrap and constrains width. For longer descriptions, use a Popover instead; Tooltip is for short, single-line hints.",
      },
    },
  },
};

/* ── Inside scroll container with portal ── */

export const InsideScrollContainer: Story = {
  name: "Inside Scroll Container",
  render: () => (
    <div
      style={{
        width: 200,
        height: 200,
        overflow: "hidden",
        border: "1px solid rgba(0,0,0,0.12)",
        borderRadius: 8,
        padding: 16,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Tooltip content="This tooltip uses portal mode" position="top" portal={true}>
        <Button variant="secondary">Hover me</Button>
      </Tooltip>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Tooltip inside a container with overflow: hidden. With portal={true}, the tooltip escapes the clip boundary and renders above it. Without portal, the tooltip clips. Portal opt-in fixes container-trapped tooltips.",
      },
    },
  },
};
