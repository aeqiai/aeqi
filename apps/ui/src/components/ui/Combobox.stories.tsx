import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Combobox } from "./Combobox";
import type { ComboboxOption } from "./Combobox";

const BASIC_OPTIONS: ComboboxOption[] = [
  { value: "self", label: "Self" },
  { value: "siblings", label: "Siblings" },
  { value: "children", label: "Children" },
  { value: "branch", label: "Branch" },
  { value: "global", label: "Global" },
];

const MODEL_OPTIONS: ComboboxOption[] = [
  {
    value: "anthropic/claude-opus-4",
    label: "Claude Opus 4",
    meta: <span style={{ fontSize: "0.7rem", opacity: 0.6 }}>frontier · 200K</span>,
  },
  {
    value: "anthropic/claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    meta: <span style={{ fontSize: "0.7rem", opacity: 0.6 }}>balanced · 200K</span>,
  },
  {
    value: "anthropic/claude-haiku-4",
    label: "Claude Haiku 4",
    meta: <span style={{ fontSize: "0.7rem", opacity: 0.6 }}>cheap · 200K</span>,
  },
  {
    value: "openai/gpt-4o",
    label: "GPT-4o",
    meta: <span style={{ fontSize: "0.7rem", opacity: 0.6 }}>balanced</span>,
    disabled: true,
  },
  {
    value: "google/gemini-2-flash",
    label: "Gemini 2.0 Flash",
    meta: <span style={{ fontSize: "0.7rem", opacity: 0.6 }}>cheap</span>,
  },
];

// Generate 50+ options for the large list story.
const LARGE_OPTIONS: ComboboxOption[] = Array.from({ length: 60 }, (_, i) => ({
  value: `option-${i + 1}`,
  label: `Option ${i + 1} — item ${String.fromCharCode(65 + (i % 26))}${i + 1}`,
  meta:
    i % 7 === 0 ? <span style={{ fontSize: "0.7rem", color: "var(--accent)" }}>★</span> : undefined,
}));

const meta: Meta<typeof Combobox> = {
  title: "Primitives/Inputs/Combobox",
  component: Combobox,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component: `
Searchable dropdown with support for option meta text, leading icons, disabled options, empty state, and a footer slot. Use when the user needs to filter a list by typing.

**Size rule:** \`md\` (32px) is the default. Use \`sm\` for toolbars and compact layouts.
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
type Story = StoryObj<typeof Combobox>;

export const Default: Story = {
  name: "Default",
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [value, setValue] = useState<string | null>("self");
    return (
      <div style={{ maxWidth: 240 }}>
        <Combobox
          options={BASIC_OPTIONS}
          value={value}
          onChange={setValue}
          placeholder="Select scope…"
        />
        <p style={{ marginTop: 8, fontSize: 12, color: "rgba(0,0,0,0.45)" }}>
          Selected: <strong>{value ?? "—"}</strong>
        </p>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: "Basic searchable dropdown with ~8 options. User can type to filter.",
      },
    },
  },
};

export const AllSizes: Story = {
  name: "Size Scale",
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [valueSm, setValueSm] = useState<string | null>("self");
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [valueMd, setValueMd] = useState<string | null>("self");
    return (
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
          <div style={{ maxWidth: 200 }}>
            <Combobox options={BASIC_OPTIONS} value={valueSm} onChange={setValueSm} size="sm" />
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
            md (32px) — default
          </p>
          <div style={{ maxWidth: 240 }}>
            <Combobox options={BASIC_OPTIONS} value={valueMd} onChange={setValueMd} size="md" />
          </div>
        </div>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: "sm for toolbars; md for standard forms.",
      },
    },
  },
};

export const WithLeadingIcon: Story = {
  name: "With Leading Icons",
  render: () => {
    const STATUS_OPTIONS: ComboboxOption[] = [
      {
        value: "active",
        label: "Active",
        meta: (
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: "var(--color-success)",
              marginRight: 6,
            }}
          />
        ),
      },
      {
        value: "paused",
        label: "Paused",
        meta: (
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: "var(--color-warning)",
              marginRight: 6,
            }}
          />
        ),
      },
      {
        value: "completed",
        label: "Completed",
        meta: (
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: "var(--color-success)",
              marginRight: 6,
            }}
          />
        ),
      },
      {
        value: "failed",
        label: "Failed",
        meta: (
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: "var(--color-danger)",
              marginRight: 6,
            }}
          />
        ),
      },
    ];
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [value, setValue] = useState<string | null>("active");
    return (
      <div style={{ maxWidth: 240 }}>
        <Combobox
          options={STATUS_OPTIONS}
          value={value}
          onChange={setValue}
          placeholder="Select status…"
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          "Options with leading icons (status dots) or other visual indicators rendered in the meta slot.",
      },
    },
  },
};

export const WithFooter: Story = {
  name: "With Footer (+ New option)",
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [value, setValue] = useState<string | null>("self");
    return (
      <div style={{ maxWidth: 280 }}>
        <Combobox
          options={BASIC_OPTIONS}
          value={value}
          onChange={setValue}
          placeholder="Select scope…"
          footer={
            <div
              style={{
                padding: "8px 12px",
                borderTop: "1px solid var(--color-border)",
                fontSize: 13,
              }}
            >
              <button
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--color-accent)",
                  cursor: "pointer",
                  fontSize: 13,
                  padding: 0,
                  textAlign: "left",
                }}
              >
                + Create new scope
              </button>
            </div>
          }
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          "Footer slot demonstrates a '+ New option' pattern. Rendered at the bottom of the floating panel, separated by a divider.",
      },
    },
  },
};

export const LargeList: Story = {
  name: "Long List (30+ options)",
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [value, setValue] = useState<string | null>("option-1");
    return (
      <div style={{ maxWidth: 300 }}>
        <Combobox
          options={LARGE_OPTIONS}
          value={value}
          onChange={setValue}
          placeholder="Pick an option…"
          searchPlaceholder="Filter options…"
        />
        <p style={{ marginTop: 8, fontSize: 12, color: "rgba(0,0,0,0.45)" }}>
          Selected: <strong>{value ?? "—"}</strong>
        </p>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: "Demonstrates scroll behavior and max-height constraints with 60+ options.",
      },
    },
  },
};

export const WithMeta: Story = {
  name: "With Meta (secondary text)",
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [value, setValue] = useState<string | null>("anthropic/claude-sonnet-4-6");
    return (
      <div style={{ maxWidth: 300 }}>
        <Combobox
          options={MODEL_OPTIONS}
          value={value}
          onChange={setValue}
          placeholder="Choose a model…"
          searchPlaceholder="Search models…"
        />
        <p style={{ marginTop: 8, fontSize: 12, color: "rgba(0,0,0,0.45)" }}>
          Selected: <strong>{value ?? "—"}</strong>
        </p>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          "Options with secondary meta info (context window, tier labels) on the right. Useful for models, environments, or other multi-attribute choices.",
      },
    },
  },
};

export const EmptyState: Story = {
  name: "Empty State (no matches)",
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [value, setValue] = useState<string | null>(null);
    return (
      <div style={{ maxWidth: 240 }}>
        <Combobox
          options={BASIC_OPTIONS}
          value={value}
          onChange={setValue}
          placeholder="Select scope…"
          searchPlaceholder="Try typing 'zzz' to see empty state…"
          emptyLabel="No scopes match your search"
        />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          "Shows the empty state when search query yields zero matches. User can see the custom emptyLabel message.",
      },
    },
  },
};

export const DisabledOptions: Story = {
  name: "Disabled Options",
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [value, setValue] = useState<string | null>("anthropic/claude-opus-4");
    return (
      <div style={{ maxWidth: 300 }}>
        <Combobox
          options={MODEL_OPTIONS}
          value={value}
          onChange={setValue}
          placeholder="Choose a model…"
        />
        <p style={{ marginTop: 8, fontSize: 12, color: "rgba(0,0,0,0.45)" }}>
          GPT-4o is disabled. Selected: <strong>{value ?? "—"}</strong>
        </p>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          "Option-level disabled state. Some options (e.g. unavailable models) are visually muted and non-interactive.",
      },
    },
  },
};

export const Disabled: Story = {
  name: "Disabled Trigger",
  args: {
    options: BASIC_OPTIONS,
    value: "self",
    disabled: true,
  },
  parameters: {
    docs: {
      description: {
        story: "Disabled combobox prevents opening the dropdown or selecting a new value.",
      },
    },
  },
};
