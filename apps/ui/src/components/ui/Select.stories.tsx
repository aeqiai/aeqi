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
  parameters: {
    docs: {
      description: {
        component: `
Native HTML select element with aeqi design tokens. Use for predefined option sets where the user chooses one value. For searchable lists, use Combobox instead.

**Size rule:** \`md\` (32px) matches the app's \`--input-h\` rhythm. Use \`sm\` for toolbars.
        `,
      },
    },
  },
  argTypes: {
    size: {
      control: "select",
      options: ["sm", "md"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Select>;

export const Default: Story = {
  args: {
    options: SCOPE_OPTIONS,
    value: "self",
  },
  parameters: {
    docs: {
      description: {
        story: "Basic select with md size and initial value. Trigger shows the selected option.",
      },
    },
  },
};

export const AllSizes: Story = {
  name: "Size Scale",
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
        <Select options={SCOPE_OPTIONS} value="self" size="sm" />
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
        <Select options={SCOPE_OPTIONS} value="self" size="md" />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: "sm for toolbars and compact layouts; md for standard forms.",
      },
    },
  },
};

export const WithPlaceholder: Story = {
  name: "Empty State (placeholder)",
  args: {
    options: MODEL_OPTIONS,
    placeholder: "Select a model…",
    value: "",
  },
  parameters: {
    docs: {
      description: {
        story: "Empty initial state with placeholder text shown in the trigger before selection.",
      },
    },
  },
};

export const Disabled: Story = {
  args: {
    options: SCOPE_OPTIONS,
    value: "global",
    disabled: true,
  },
  parameters: {
    docs: {
      description: {
        story: "Disabled select prevents interaction.",
      },
    },
  },
};

export const WithDisabledOption: Story = {
  name: "With Disabled Option",
  args: {
    options: MODEL_OPTIONS,
    value: "claude-opus-4",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Option-level disabled state (some options not selectable). GPT-4o is disabled in this example.",
      },
    },
  },
};

export const FullWidth: Story = {
  name: "Full Width",
  render: () => (
    <div style={{ maxWidth: 360 }}>
      <Select options={SCOPE_OPTIONS} value="self" />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Select stretches to fill the width of its container. Use in forms where the input should span the available width.",
      },
    },
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
