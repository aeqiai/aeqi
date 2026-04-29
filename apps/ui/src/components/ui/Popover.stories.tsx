import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Popover } from "./Popover";
import { Button } from "./Button";

const meta: Meta<typeof Popover> = {
  title: "Primitives/Overlays/Popover",
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

/* ── Portal mode with scrollable container ── */

export const PortalMode: Story = {
  name: "Portal Mode",
  render: () => (
    <div style={{ padding: 40 }}>
      <div
        style={{
          width: 300,
          height: 300,
          overflowY: "auto",
          border: "1px solid rgba(0,0,0,0.12)",
          borderRadius: 8,
          padding: 16,
          background: "rgba(0,0,0,0.02)",
        }}
      >
        <div
          style={{
            height: 400,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <Popover
            trigger={<Button variant="secondary">Open (portal mode)</Button>}
            placement="bottom-start"
            portal={true}
          >
            <SampleContent />
          </Popover>
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Popover with portal={true} inside a scrollable container. The bubble escapes the overflow boundary and stays anchored to the trigger. Portal mode prevents clipping; omit it for inline behaviour.",
      },
    },
  },
};

/* ── Long list with scroll ── */

export const LongList: Story = {
  name: "Long List",
  render: () => (
    <div style={{ padding: 40 }}>
      <Popover trigger={<Button variant="secondary">Many Items</Button>} placement="bottom-start">
        <div style={{ padding: "8px 0", maxHeight: 300, overflowY: "auto" }}>
          {Array.from({ length: 25 }).map((_, i) => (
            <div
              key={i}
              style={{
                padding: "6px 14px",
                fontSize: 13,
                cursor: "pointer",
                color: "var(--text-primary)",
                borderBottom: i < 24 ? "1px solid rgba(0,0,0,0.06)" : "none",
              }}
            >
              Quest {i + 1}:{" "}
              {["Refactor auth", "Add logging", "Fix bug", "Write docs", "Review PR"][i % 5]}
            </div>
          ))}
        </div>
      </Popover>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Popover containing 25+ menu items. The panel itself scrolls (max-height + overflow-y: auto). Demonstrates scrolling within a bounded popover panel.",
      },
    },
  },
};

/* ── Disabled trigger ── */

export const DisabledTrigger: Story = {
  name: "Disabled Trigger",
  render: () => (
    <div style={{ padding: 40 }}>
      <Popover
        trigger={
          <Button variant="secondary" disabled>
            Can't Open
          </Button>
        }
        placement="bottom-start"
      >
        <SampleContent />
      </Popover>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Trigger button is disabled={true}. Clicking the disabled trigger does not open the popover. The affordance communicates that interaction is unavailable.",
      },
    },
  },
};
