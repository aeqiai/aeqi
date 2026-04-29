import type { Meta, StoryObj } from "@storybook/react";
import { Input } from "./Input";
import { Button } from "./Button";

const meta: Meta<typeof Input> = {
  title: "Primitives/Inputs/Input",
  component: Input,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: `
Single-line text input with optional label, hint text, and error state. Use the label / hint / error triplet for inline form validation feedback.

**Size rule:** \`md\` (32px) matches the app's \`--input-h\` / \`--sidebar-row-h\` rhythm (e.g. quest list item height). Use \`sm\` for compact toolbars, \`lg\` for hero forms.
        `,
      },
    },
  },
  argTypes: {
    size: {
      control: "select",
      options: ["sm", "md", "lg"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Input>;

/* ── Individual states ── */

export const Default: Story = {
  args: { placeholder: "Enter value..." },
  parameters: {
    docs: {
      description: {
        story: "Basic single-line input with placeholder. No label required.",
      },
    },
  },
};

/* ── Size scale ── */

export const AllSizes: Story = {
  name: "Size Scale",
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
          sm (28px)
        </p>
        <Input size="sm" placeholder="Compact input..." />
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
          md (32px) — default
        </p>
        <Input size="md" placeholder="Standard input..." />
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
          lg (40px)
        </p>
        <Input size="lg" placeholder="Large input..." />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "sm for toolbars and compact layouts; md for standard forms; lg for hero sections and onboarding flows.",
      },
    },
  },
};

export const WithLabel: Story = {
  args: { label: "Agent Name", placeholder: "my-agent" },
  parameters: {
    docs: {
      description: {
        story: "Input with optional label rendered above the field.",
      },
    },
  },
};

export const WithHelper: Story = {
  name: "With Helper Text",
  args: {
    label: "Agent Slug",
    placeholder: "code-reviewer",
    hint: "Lowercase letters, numbers, and hyphens only",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Hint text rendered below the input when no error is present. Use for guidance without blocking submission.",
      },
    },
  },
};

export const WithError: Story = {
  args: {
    label: "Agent Name",
    value: "Invalid Name!",
    error: "Name must contain only lowercase letters, numbers, and hyphens",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Error state with role='alert' for screen readers. Replaces hint text and sets aria-invalid=true.",
      },
    },
  },
};

export const Disabled: Story = {
  args: { label: "Runtime ID", value: "rt-8f3a2b1c", disabled: true },
  parameters: {
    docs: {
      description: {
        story: "Disabled input for read-only or locked fields.",
      },
    },
  },
};

/* ── Composition: Form pattern ── */

export const FormPattern: Story = {
  name: "Form Pattern (signup)",
  render: () => (
    <div
      style={{
        maxWidth: 380,
        padding: 24,
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
      }}
    >
      <h3 style={{ fontSize: 16, fontWeight: 600, color: "rgba(0,0,0,0.85)", margin: "0 0 4px" }}>
        Create Account
      </h3>
      <p style={{ fontSize: 13, color: "rgba(0,0,0,0.4)", margin: "0 0 20px" }}>
        Set up your aeqi account.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Input label="Email" type="email" placeholder="you@example.com" />
        <Input
          label="Password"
          type="password"
          placeholder="••••••••"
          hint="At least 12 characters recommended"
        />
        <Input label="Full Name" placeholder="Alice Chen" />
      </div>
      <div
        style={{
          marginTop: 24,
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
          borderTop: "1px solid var(--color-border)",
          paddingTop: 16,
        }}
      >
        <Button variant="secondary">Cancel</Button>
        <Button variant="primary">Create Account</Button>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Canonical signup-form shape: 3 stacked Inputs with consistent label/hint rhythm, inside a padded container with Cancel/Create buttons.",
      },
    },
  },
};

/* ── Composition: Agent creation form ── */

export const AgentCreationForm: Story = {
  name: "Agent Creation Form",
  render: () => (
    <div
      style={{
        maxWidth: 420,
        padding: 24,
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: 8,
      }}
    >
      <h3 style={{ fontSize: 16, fontWeight: 600, color: "rgba(0,0,0,0.85)", margin: "0 0 4px" }}>
        Create Agent
      </h3>
      <p style={{ fontSize: 13, color: "rgba(0,0,0,0.4)", margin: "0 0 20px" }}>
        Define a new autonomous agent in your runtime.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Input label="Name" placeholder="code-reviewer" hint="Unique identifier for this agent" />
        <Input label="Model" placeholder="claude-3-opus" />
        <Input label="Identity" placeholder="You are a code review agent that..." />
        <Input
          label="Parent Agent"
          placeholder="orchestrator"
          hint="Optional parent in the hierarchy"
        />
      </div>
      <div
        style={{
          marginTop: 24,
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

/* ── Composition: Search / filter input ── */

export const SearchInput: Story = {
  name: "Search Pattern",
  render: () => (
    <div style={{ maxWidth: 360 }}>
      <div style={{ position: "relative" }}>
        <Input placeholder="Search quests, agents, ideas..." />
        <span
          style={{
            position: "absolute",
            right: 12,
            top: "50%",
            transform: "translateY(-50%)",
            fontSize: 11,
            color: "rgba(0,0,0,0.3)",
            fontFamily: "var(--font-sans)",
            padding: "2px 6px",
            border: "1px solid rgba(0,0,0,0.1)",
            borderRadius: 4,
          }}
        >
          Cmd+K
        </span>
      </div>
    </div>
  ),
};

/* ── Composition: Settings form with mixed states ── */

export const SettingsForm: Story = {
  name: "Settings Form",
  render: () => (
    <div
      style={{
        maxWidth: 420,
        padding: 24,
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: 8,
      }}
    >
      <h3 style={{ fontSize: 16, fontWeight: 600, color: "rgba(0,0,0,0.85)", margin: "0 0 16px" }}>
        Daemon Settings
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Input label="API Endpoint" value="http://localhost:8400" />
        <Input label="API Key" placeholder="sk-..." hint="Your key is stored locally" />
        <Input label="Max Concurrent Quests" value="5" hint="Limit parallel agent execution" />
        <Input label="Runtime ID" value="rt-8f3a2b1c" disabled />
      </div>
      <div
        style={{
          marginTop: 24,
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
        }}
      >
        <Button variant="primary">Save Changes</Button>
      </div>
    </div>
  ),
};
