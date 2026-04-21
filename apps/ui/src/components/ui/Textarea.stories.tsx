import type { Meta, StoryObj } from "@storybook/react";
import { Textarea } from "./Textarea";
import { Button } from "./Button";

const meta: Meta<typeof Textarea> = {
  title: "Components/Textarea",
  component: Textarea,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Multi-line text input with the same label/hint/error pattern as `Input`. Use for free-form prose: identity ideas, acceptance criteria, and message composition.",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof Textarea>;

/* ── Individual states ── */

export const Default: Story = {
  args: { placeholder: "Describe what the agent should do...", rows: 4 },
};

export const WithLabel: Story = {
  args: {
    label: "Identity",
    placeholder: "You are an agent that...",
    rows: 4,
  },
};

export const WithHint: Story = {
  args: {
    label: "Acceptance criteria",
    placeholder: "Define what done looks like...",
    hint: "Be specific — agents use this to decide when a quest is complete.",
    rows: 3,
  },
};

export const WithError: Story = {
  args: {
    label: "Quest description",
    value: "fix it",
    error: "Quest description must be at least 20 characters.",
    rows: 3,
  },
};

export const Disabled: Story = {
  args: {
    label: "Identity (inherited)",
    value: "You are part of the orchestrator tree. Delegate aggressively.",
    disabled: true,
    rows: 3,
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
