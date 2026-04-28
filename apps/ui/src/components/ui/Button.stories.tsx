import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./Button";
import { Tooltip } from "./Tooltip";

const meta: Meta<typeof Button> = {
  title: "Primitives/Actions/Button",
  component: Button,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: `
**Variant decision rule** — locked across the app.

| Variant | Use when |
|---------|---------|
| \`primary\` | The one filled CTA per surface (Save, Send code, Create event). |
| \`secondary\` | Visible-at-rest partner to primary; Cancel beside Save; "Set up later" beside "Connect". |
| \`ghost\` | Quiet inline action where hover/focus reveals it (toolbar overflow, list-row × close, transcript controls). **Never** as the Cancel sibling next to a primary — pair with \`secondary\` so the dismiss path is visible at rest. |
| \`danger\` | Destructive primary (Delete agent, Sign out everywhere). |

All sizes are pill-shaped (\`--radius-full\`). Industry parallel: Stripe, Linear, Vercel, GitHub.
        `,
      },
    },
  },
  argTypes: {
    variant: {
      control: "select",
      options: ["primary", "secondary", "ghost", "danger", "light"],
    },
    size: {
      control: "select",
      options: ["sm", "md", "lg", "xl"],
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
  name: "Ghost (quiet inline)",
  args: { children: "Refresh", variant: "ghost" },
  parameters: {
    docs: {
      description: {
        story:
          "Quiet inline action where hover/focus reveals the affordance — toolbar overflow, list-row × close, transcript controls. Do **not** use as the Cancel sibling next to a primary CTA; pair with `secondary` instead so the dismiss path stays visible at rest.",
      },
    },
  },
};

export const Danger: Story = {
  args: { children: "Delete Agent", variant: "danger" },
};

/* ── Sizes ── */

export const AllSizes: Story = {
  name: "Size Scale",
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <Button size="xl" variant="primary">
          xl (hero scale)
        </Button>
      </div>
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
  parameters: {
    docs: {
      description: {
        story:
          "Cancel beside a primary CTA uses `secondary` — outlined and visible at rest — so the dismiss path is never invisible. `ghost` would disappear into the surface until hovered.",
      },
    },
  },
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
        <Button variant="secondary">Cancel</Button>
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
            Delete
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
          <Button variant="secondary">Keep Agent</Button>
          <Button variant="danger">Delete Agent</Button>
        </div>
      </div>
    </div>
  ),
};

/* ── New features: xl size, light variant, trailing icon ── */

export const ExtraLarge: Story = {
  name: "Extra Large (xl)",
  args: {
    children: "Start a company",
    variant: "primary",
    size: "xl",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Large hero scale for marketing surfaces (hero CTA, footer actions). Matches landing hero button dimensions.",
      },
    },
  },
};

export const LightVariant: Story = {
  name: "Light Variant (on dark)",
  render: () => (
    <div
      style={{
        background: "var(--color-bg-elevated)",
        padding: 24,
        borderRadius: 8,
      }}
    >
      <Button variant="light" size="md">
        Explore
      </Button>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "White button for use on dark or accent surfaces (e.g., footer with accent background). Maintains contrast and inverts the primary variant.",
      },
    },
  },
};

export const WithTrailingIcon: Story = {
  name: "With Trailing Icon",
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <p style={{ fontSize: 12, color: "rgba(0,0,0,0.4)", margin: "0 0 8px" }}>
          Hero CTA with chevron
        </p>
        <Button
          variant="primary"
          size="xl"
          trailingIcon={
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M6 12l4-4-4-4" />
            </svg>
          }
        >
          Start a company
        </Button>
      </div>
      <div>
        <p style={{ fontSize: 12, color: "rgba(0,0,0,0.4)", margin: "0 0 8px" }}>
          Standard size with arrow
        </p>
        <Button
          variant="secondary"
          size="md"
          trailingIcon={
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M6 12l4-4-4-4" />
            </svg>
          }
        >
          Learn more
        </Button>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Trailing icon (chevron, arrow, etc.) rendered to the right of the label. Animates with a 3px translate-x on hover for a subtle forward-motion micro-interaction.",
      },
    },
  },
};
