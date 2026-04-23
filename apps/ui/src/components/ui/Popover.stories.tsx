import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Popover } from "./Popover";
import { Button } from "./Button";

const meta: Meta<typeof Popover> = {
  title: "Components/Popover",
  component: Popover,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Popover>;

const SampleContent = () => (
  <div style={{ padding: "8px 0" }}>
    {["Option A", "Option B", "Option C"].map((label) => (
      <div
        key={label}
        style={{
          padding: "6px 14px",
          fontSize: 13,
          cursor: "pointer",
          color: "var(--text-primary)",
        }}
      >
        {label}
      </div>
    ))}
  </div>
);

export const BottomStart: Story = {
  name: "Placement: bottom-start",
  render: () => (
    <div style={{ padding: 40 }}>
      <Popover trigger={<Button variant="secondary">Open</Button>} placement="bottom-start">
        <SampleContent />
      </Popover>
    </div>
  ),
};

export const BottomEnd: Story = {
  name: "Placement: bottom-end",
  render: () => (
    <div style={{ padding: 40, display: "flex", justifyContent: "flex-end" }}>
      <Popover trigger={<Button variant="secondary">Open</Button>} placement="bottom-end">
        <SampleContent />
      </Popover>
    </div>
  ),
};

export const TopStart: Story = {
  name: "Placement: top-start",
  render: () => (
    <div style={{ padding: 120, paddingTop: 40 }}>
      <Popover trigger={<Button variant="secondary">Open above</Button>} placement="top-start">
        <SampleContent />
      </Popover>
    </div>
  ),
};

export const TopEnd: Story = {
  name: "Placement: top-end",
  render: () => (
    <div style={{ padding: 120, display: "flex", justifyContent: "flex-end" }}>
      <Popover trigger={<Button variant="secondary">Open above</Button>} placement="top-end">
        <SampleContent />
      </Popover>
    </div>
  ),
};

export const Controlled: Story = {
  name: "Controlled (open/close from parent)",
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [open, setOpen] = useState(false);
    return (
      <div style={{ padding: 40, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="primary" onClick={() => setOpen(true)}>
            Open
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
        <Popover
          trigger={<Button variant="secondary">Trigger ({open ? "open" : "closed"})</Button>}
          open={open}
          onOpenChange={setOpen}
          placement="bottom-start"
        >
          <SampleContent />
        </Popover>
      </div>
    );
  },
};

export const Uncontrolled: Story = {
  name: "Uncontrolled (self-managed state)",
  render: () => (
    <div style={{ padding: 40 }}>
      <Popover trigger={<Button variant="secondary">Toggle me</Button>} placement="bottom-start">
        <SampleContent />
      </Popover>
    </div>
  ),
};
