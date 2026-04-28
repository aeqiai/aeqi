import type { StoryObj } from "@storybook/react";
import { SelectOption } from "./SelectOption";

const meta = {
  title: "Components/SelectOption",
  component: SelectOption,
  tags: ["autodocs"],
  argTypes: {
    selected: {
      control: "boolean",
      description: "Whether this option is currently selected",
    },
    leadingIcon: {
      control: false,
      description: "Optional icon rendered to the left of the label",
    },
    trailingHint: {
      control: "text",
      description: "Optional secondary text (e.g. keyboard shortcut)",
    },
    disabled: {
      control: "boolean",
      description: "Whether the option is disabled",
    },
    children: {
      control: "text",
      description: "The option label",
    },
  },
};

export default meta;
type Story = StoryObj<typeof SelectOption>;

/**
 * Default list of four options with one selected.
 */
export const Default: Story = {
  render: () => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 0,
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        maxWidth: 220,
      }}
    >
      <SelectOption selected={true}>Option A</SelectOption>
      <SelectOption>Option B</SelectOption>
      <SelectOption>Option C</SelectOption>
      <SelectOption>Option D</SelectOption>
    </div>
  ),
};

/**
 * Options with leading icons (e.g. status dots, glyph indicators).
 */
export const WithLeadingIcons: Story = {
  render: () => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 0,
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        maxWidth: 220,
      }}
    >
      <SelectOption selected={true} leadingIcon={<Dot color="green" />}>
        Active
      </SelectOption>
      <SelectOption leadingIcon={<Dot color="amber" />}>Pending</SelectOption>
      <SelectOption leadingIcon={<Dot color="red" />}>Failed</SelectOption>
      <SelectOption leadingIcon={<Dot color="slate" />}>Skipped</SelectOption>
    </div>
  ),
};

/**
 * Options with trailing hints (e.g. keyboard shortcuts, counts).
 */
export const WithTrailingHint: Story = {
  render: () => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 0,
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        maxWidth: 260,
      }}
    >
      <SelectOption selected={true} trailingHint="⌘N">
        New Item
      </SelectOption>
      <SelectOption trailingHint="⌘K">Search</SelectOption>
      <SelectOption trailingHint="⌘,">Settings</SelectOption>
      <SelectOption trailingHint="⌘?">Help</SelectOption>
    </div>
  ),
};

/**
 * Disabled option state.
 */
export const Disabled: Story = {
  render: () => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 0,
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        maxWidth: 220,
      }}
    >
      <SelectOption selected={true}>Enabled</SelectOption>
      <SelectOption disabled>Disabled option</SelectOption>
      <SelectOption>Available</SelectOption>
    </div>
  ),
};

/**
 * Interactive example with hover and selection state changes.
 */
export const Interactive: Story = {
  render: function Render() {
    const [selected, setSelected] = React.useState("a");
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 0,
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
          maxWidth: 220,
        }}
      >
        {[
          { id: "a", label: "Apple" },
          { id: "b", label: "Banana" },
          { id: "c", label: "Cherry" },
          { id: "d", label: "Date" },
        ].map((option) => (
          <SelectOption
            key={option.id}
            selected={selected === option.id}
            onClick={() => setSelected(option.id)}
          >
            {option.label}
          </SelectOption>
        ))}
      </div>
    );
  },
};

// Helper component for status dot
function Dot({ color }: { color: string }) {
  const colorMap: Record<string, string> = {
    green: "#10b981",
    amber: "#f59e0b",
    red: "#ef4444",
    slate: "#64748b",
  };
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
      <circle cx="4" cy="4" r="4" fill={colorMap[color]} />
    </svg>
  );
}

// Import React for the Interactive story
import React from "react";
