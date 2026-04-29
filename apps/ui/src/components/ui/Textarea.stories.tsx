import type { Meta, StoryObj } from "@storybook/react";
import { Textarea } from "./Textarea";
import { Button } from "./Button";

const meta: Meta<typeof Textarea> = {
  title: "Primitives/Inputs/Textarea",
  component: Textarea,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Multi-line text input with the same label/hint/error pattern as `Input`. Use for free-form prose: identity ideas, acceptance criteria, and message composition. Bare mode (bare=true) emits only the textarea element for use in custom flex layouts.",
      },
    },
  },
  argTypes: {
    bare: {
      control: "boolean",
      description: "When true, renders only the textarea without wrapper/label/hint/error chrome.",
    },
  },
};

export default meta;
type Story = StoryObj<typeof Textarea>;

/* ── Individual states ── */

export const Default: Story = {
  args: { placeholder: "Describe what the agent should do...", rows: 4 },
  parameters: {
    docs: {
      description: {
        story: "Basic multi-line input with placeholder and row height.",
      },
    },
  },
};

export const WithLabel: Story = {
  args: {
    label: "Identity",
    placeholder: "You are an agent that...",
    rows: 4,
  },
  parameters: {
    docs: {
      description: {
        story: "Textarea with optional label rendered above the field.",
      },
    },
  },
};

export const WithHelper: Story = {
  name: "With Helper Text",
  args: {
    label: "Acceptance criteria",
    placeholder: "Define what done looks like...",
    hint: "Be specific — agents use this to decide when a quest is complete.",
    rows: 3,
  },
  parameters: {
    docs: {
      description: {
        story: "Hint text rendered below the textarea when no error is present.",
      },
    },
  },
};

export const WithError: Story = {
  args: {
    label: "Quest description",
    value: "fix it",
    error: "Quest description must be at least 20 characters.",
    rows: 3,
  },
  parameters: {
    docs: {
      description: {
        story: "Error state with role='alert'. Replaces hint text and sets aria-invalid=true.",
      },
    },
  },
};

export const Disabled: Story = {
  args: {
    label: "Identity (inherited)",
    value: "You are part of the orchestrator tree. Delegate aggressively.",
    disabled: true,
    rows: 3,
  },
  parameters: {
    docs: {
      description: {
        story: "Disabled textarea for read-only or locked fields.",
      },
    },
  },
};

/* ── Size / affordance ── */

export const MinHeight: Story = {
  name: "Min Height (empty affordance)",
  render: () => (
    <div style={{ maxWidth: 420 }}>
      <Textarea
        label="Notes"
        placeholder="Start typing..."
        style={{ minHeight: "120px" }}
        rows={3}
      />
      <p style={{ fontSize: 12, color: "rgba(0,0,0,0.45)", marginTop: 8, margin: 0 }}>
        min-height creates multi-line affordance even with empty content.
      </p>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Demonstrates how min-height on the textarea element creates the multi-line affordance before the user types.",
      },
    },
  },
};

/* ── Bare mode ── */

export const BareComposer: Story = {
  name: "Bare Mode (composer)",
  render: () => (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "flex-end",
        padding: 16,
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        backgroundColor: "var(--color-bg-paper)",
      }}
    >
      <Textarea
        bare={true}
        placeholder="Send a message..."
        rows={1}
        style={{ flex: 1, minHeight: "40px" }}
      />
      <Button variant="primary" size="md">
        Send
      </Button>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Bare mode emits only the textarea without wrapper/label/hint/error chrome. Use when a surface owns its own form chrome (chat composers, inline editors). The parent controls spacing, layout, and button placement.",
      },
    },
  },
};

/* ── Composition: Quest creation form ── */

export const QuestComposer: Story = {
  name: "Quest Composer",
  render: () => (
    <div
      style={{
        maxWidth: 480,
        padding: 24,
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: 8,
      }}
    >
      <h3 style={{ fontSize: 16, fontWeight: 600, color: "rgba(0,0,0,0.85)", margin: "0 0 4px" }}>
        New quest
      </h3>
      <p style={{ fontSize: 13, color: "rgba(0,0,0,0.4)", margin: "0 0 20px" }}>
        Describe the work. An agent will pick it up.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Textarea
          label="Objective"
          placeholder="Refactor the payments module to use the new SDK..."
          rows={3}
        />
        <Textarea
          label="Acceptance criteria"
          placeholder="Done when tests pass, old SDK uninstalled, and PR merged."
          hint="The agent uses this to decide when the quest is complete."
          rows={3}
        />
      </div>
      <div
        style={{
          marginTop: 20,
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
          borderTop: "1px solid rgba(0,0,0,0.08)",
          paddingTop: 16,
        }}
      >
        <Button variant="ghost">Cancel</Button>
        <Button variant="primary">Create quest</Button>
      </div>
    </div>
  ),
};

/* ── Composition: Identity editor (long-form) ── */

export const IdentityEditor: Story = {
  name: "Identity Editor",
  render: () => (
    <div style={{ maxWidth: 520 }}>
      <Textarea
        label="Agent identity"
        defaultValue={`You are the CTO agent in the aeqi tree. You set technical direction, review
architectural proposals from subordinate agents, and delegate implementation
to the appropriate specialist. You do not write code yourself — you orchestrate.`}
        rows={8}
        hint="Assembled into the agent's identity on every turn."
      />
    </div>
  ),
};
