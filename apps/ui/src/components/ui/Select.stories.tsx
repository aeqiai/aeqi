import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Select } from "./Select";

const SCOPE_OPTIONS = [
  { value: "self", label: "self" },
  { value: "siblings", label: "siblings" },
  { value: "children", label: "children" },
  { value: "branch", label: "branch" },
  { value: "global", label: "global" },
];

const MODEL_OPTIONS = [
  { value: "claude-opus-4", label: "Claude Opus 4" },
  { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
  { value: "claude-haiku-4", label: "Claude Haiku 4" },
  { value: "gpt-4o", label: "GPT-4o", disabled: true },
];

const meta: Meta<typeof Select> = {
  title: "Primitives/Inputs/Select",
  component: Select,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Select>;

export const Default: Story = {
  args: {
    options: SCOPE_OPTIONS,
    value: "self",
  },
};

export const SizeSm: Story = {
  name: "Size: sm",
  args: {
    options: SCOPE_OPTIONS,
    value: "self",
    size: "sm",
  },
};

export const SizeMd: Story = {
  name: "Size: md",
  args: {
    options: SCOPE_OPTIONS,
    value: "self",
    size: "md",
  },
};

export const WithPlaceholder: Story = {
  name: "Empty state (placeholder)",
  args: {
    options: MODEL_OPTIONS,
    placeholder: "Select a model…",
    value: "",
  },
};

export const Disabled: Story = {
  args: {
    options: SCOPE_OPTIONS,
    value: "global",
    disabled: true,
  },
};

export const WithDisabledOption: Story = {
  name: "Option disabled",
  args: {
    options: MODEL_OPTIONS,
    value: "claude-opus-4",
  },
};

export const Controlled: Story = {
  name: "Controlled (interactive)",
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [value, setValue] = useState("self");
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 240 }}>
        <Select options={SCOPE_OPTIONS} value={value} onChange={setValue} />
        <p style={{ fontSize: 12, color: "rgba(0,0,0,0.45)", margin: 0 }}>
          Selected: <strong>{value}</strong>
        </p>
      </div>
    );
  },
};

export const BothSizes: Story = {
  name: "Both sizes",
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 240 }}>
      <Select options={SCOPE_OPTIONS} value="self" size="sm" />
      <Select options={SCOPE_OPTIONS} value="self" size="md" />
    </div>
  ),
};
