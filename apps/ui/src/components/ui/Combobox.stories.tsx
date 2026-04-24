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
  },
};

export default meta;
type Story = StoryObj<typeof Combobox>;

export const Basic: Story = {
  name: "Basic usage",
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
};

export const LargeList: Story = {
  name: "50+ options",
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
};

export const WithMeta: Story = {
  name: "With meta (label + secondary text)",
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
};

export const DisabledOptions: Story = {
  name: "Disabled options",
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
};

export const EmptyState: Story = {
  name: "Empty state",
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
};

export const DisabledTrigger: Story = {
  name: "Disabled trigger",
  args: {
    options: BASIC_OPTIONS,
    value: "self",
    disabled: true,
  },
};

export const SizeSm: Story = {
  name: "Size: sm",
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [value, setValue] = useState<string | null>("self");
    return (
      <div style={{ maxWidth: 200 }}>
        <Combobox options={BASIC_OPTIONS} value={value} onChange={setValue} size="sm" />
      </div>
    );
  },
};
