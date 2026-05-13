import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import ToolbarRadioPopover from "./ToolbarRadioPopover";

const meta: Meta<typeof ToolbarRadioPopover> = {
  title: "Primitives/Toolbar/ToolbarRadioPopover",
  component: ToolbarRadioPopover,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof ToolbarRadioPopover>;

const SortGlyph = (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" aria-hidden>
    <path d="M3 3.5h7M3 6.5h5M3 9.5h3" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const ViewGlyph = (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" aria-hidden>
    <rect x="2" y="2" width="3.5" height="3.5" strokeWidth="1.2" rx="0.4" />
    <rect x="7.5" y="2" width="3.5" height="3.5" strokeWidth="1.2" rx="0.4" />
    <rect x="2" y="7.5" width="3.5" height="3.5" strokeWidth="1.2" rx="0.4" />
    <rect x="7.5" y="7.5" width="3.5" height="3.5" strokeWidth="1.2" rx="0.4" />
  </svg>
);

type Sort = "recent" | "alpha-asc" | "alpha-desc";

function SortHarness() {
  const [value, setValue] = useState<Sort>("recent");
  const labels: Record<Sort, string> = {
    recent: "Recent",
    "alpha-asc": "Name (A→Z)",
    "alpha-desc": "Name (Z→A)",
  };
  return (
    <div style={{ display: "inline-flex", padding: 24 }}>
      <ToolbarRadioPopover
        label="Sort"
        current={labels[value]}
        glyph={SortGlyph}
        options={[
          { id: "recent", label: "Recent" },
          { id: "alpha-asc", label: "Name (A→Z)" },
          { id: "alpha-desc", label: "Name (Z→A)" },
        ]}
        value={value}
        onChange={setValue}
      />
    </div>
  );
}

type View = "list" | "grid";

function ViewIndicatorHarness() {
  const [value, setValue] = useState<View>("grid");
  const labels: Record<View, string> = { list: "List", grid: "Grid" };
  return (
    <div style={{ display: "inline-flex", padding: 24 }}>
      <ToolbarRadioPopover
        label="View"
        current={labels[value]}
        glyph={ViewGlyph}
        options={[
          { id: "list", label: "List" },
          { id: "grid", label: "Grid" },
        ]}
        value={value}
        onChange={setValue}
        indicator={value !== "list"}
      />
    </div>
  );
}

export const Sort: Story = {
  render: () => <SortHarness />,
};

export const WithIndicatorDot: Story = {
  render: () => <ViewIndicatorHarness />,
};
