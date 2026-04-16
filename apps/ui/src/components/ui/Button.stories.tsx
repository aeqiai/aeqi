import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./Button";
import { Tooltip } from "./Tooltip";

const meta: Meta<typeof Button> = {
  title: "Components/Button",
  component: Button,
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["primary", "secondary", "ghost", "danger"],
    },
    size: {
      control: "select",
      options: ["sm", "md", "lg"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

/* ── Individual variants ── */

export const Primary: Story = {
  args: { children: "Create Quest", variant: "primary" },
};

export const Secondary: Story = {
  args: { children: "View Details", variant: "secondary" },
};

export const Ghost: Story = {
  args: { children: "Cancel", variant: "ghost" },
};

export const Danger: Story = {
  args: { children: "Delete Agent", variant: "danger" },
};

/* ── Sizes ── */

export const AllSizes: Story = {
  name: "Size Scale",
  render: () => (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <Button size="sm" variant="secondary">
        sm
      </Button>
      <Button size="md" variant="secondary">
        md
      </Button>
      <Button size="lg" variant="secondary">
        lg
      </Button>
    </div>
  ),
};

/* ── States ── */

export const Disabled: Story = {
  args: { children: "Cannot Submit", variant: "primary", disabled: true },
};

export const Loading: Story = {
  args: { children: "Deploying...", variant: "primary", loading: true },
};

/* ── Composition: Loading state transition ── */

function LoadingTransitionDemo() {
  const [loading, setLoading] = useState(false);

  function handleClick() {
    setLoading(true);
    setTimeout(() => setLoading(false), 2000);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 280 }}>
      <p style={{ fontSize: 13, color: "rgba(0,0,0,0.55)", margin: 0 }}>
        Click to simulate a 2-second async operation.
      </p>
      <Button variant="primary" loading={loading} onClick={handleClick}>
        {loading ? "Saving quest..." : "Save Quest"}
      </Button>
    </div>
  );
}

export const LoadingTransition: Story = {
  name: "Loading State Transition",
  render: () => <LoadingTransitionDemo />,
};

/* ── Composition: Agent toolbar ── */

export const AgentToolbar: Story = {
  name: "Toolbar Pattern",
  render: () => (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        padding: "12px 16px",
        borderBottom: "1px solid rgba(0,0,0,0.08)",
      }}
    >
      <Button variant="primary" size="sm">
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
        New Quest
      </Button>
      <Button variant="secondary" size="sm">
        Assign Agent
      </Button>
      <div style={{ flex: 1 }} />
      <Button variant="ghost" size="sm">
        Refresh
      </Button>
      <Tooltip content="View event stream" position="bottom">
        <Button variant="ghost" size="sm">
          Events
        </Button>
      </Tooltip>
    </div>
  ),
};

/* ── Composition: Form actions ── */

export const FormActions: Story = {
  name: "Form Submit / Cancel",
  render: () => (
    <div
      style={{
        maxWidth: 400,
        padding: 24,
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: 8,
      }}
    >
      <p
        style={{
          fontSize: 13,
          color: "rgba(0,0,0,0.55)",
          margin: "0 0 20px",
        }}
      >
        Configure the agent&apos;s identity and capabilities before deployment.
      </p>
      <div
        style={{
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
          borderTop: "1px solid rgba(0,0,0,0.08)",
          paddingTop: 16,
        }}
      >
        <Button variant="ghost">Cancel</Button>
        <Button variant="primary">Create Agent</Button>
      </div>
    </div>
  ),
};

/* ── Composition: Button group ── */

export const ButtonGroup: Story = {
  name: "Button Group",
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <p
          style={{
            fontSize: 12,
            color: "rgba(0,0,0,0.4)",
            margin: "0 0 8px",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Quest actions
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="primary" size="sm">
            Start
          </Button>
          <Button variant="secondary" size="sm">
            Pause
          </Button>
          <Button variant="ghost" size="sm">
            Archive
          </Button>
          <Button variant="danger" size="sm">
            Cancel
          </Button>
        </div>
      </div>
      <div>
        <p
          style={{
            fontSize: 12,
            color: "rgba(0,0,0,0.4)",
            margin: "0 0 8px",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Destructive confirmation
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="ghost">Keep Agent</Button>
          <Button variant="danger">Delete Agent</Button>
        </div>
      </div>
    </div>
  ),
};
