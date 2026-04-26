import type { Meta, StoryObj } from "@storybook/react";
import { Input } from "./Input";
import { Button } from "./Button";

const meta: Meta<typeof Input> = {
  title: "Primitives/Inputs/Input",
  component: Input,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Input>;

/* ── Individual states ── */

export const Default: Story = {
  args: { placeholder: "Enter value..." },
};

export const WithLabel: Story = {
  args: { label: "Agent Name", placeholder: "my-agent" },
};

export const WithHint: Story = {
  args: {
    label: "Agent Slug",
    placeholder: "code-reviewer",
    hint: "Lowercase letters, numbers, and hyphens only",
  },
};

export const WithError: Story = {
  args: {
    label: "Agent Name",
    value: "Invalid Name!",
    error: "Name must contain only lowercase letters, numbers, and hyphens",
  },
};

export const Disabled: Story = {
  args: { label: "Runtime ID", value: "rt-8f3a2b1c", disabled: true },
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
