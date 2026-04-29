import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { TabTrigger } from "./TabTrigger";

const meta: Meta<typeof TabTrigger> = {
  title: "UI/TabTrigger",
  component: TabTrigger,
  tags: ["autodocs"],
  argTypes: {
    active: {
      control: "boolean",
      description: "Whether this trigger is currently selected",
    },
    onClick: {
      description: "Callback fired when the trigger is clicked",
    },
    children: {
      control: "text",
      description: "Label text or content",
    },
    leadingIcon: {
      description: "Optional icon rendered to the left of the label",
    },
    badge: {
      control: "number",
      description: "Optional badge count rendered to the right",
    },
    disabled: {
      control: "boolean",
      description: "Whether the trigger is disabled",
    },
  },
};

export default meta;
type Story = StoryObj<typeof TabTrigger>;

function DefaultExample() {
  const [active, setActive] = useState<string>("list");

  return (
    <div style={{ display: "flex", gap: "1rem", padding: "1rem" }}>
      <TabTrigger active={active === "list"} onClick={() => setActive("list")}>
        List
      </TabTrigger>
      <TabTrigger active={active === "grid"} onClick={() => setActive("grid")}>
        Grid
      </TabTrigger>
      <TabTrigger active={active === "board"} onClick={() => setActive("board")}>
        Board
      </TabTrigger>
    </div>
  );
}

/** Default: three toggles in a row, one active. */
export const Default: Story = {
  render: () => <DefaultExample />,
};

function WithBadgeExample() {
  const [active, setActive] = useState<string>("inbox");

  return (
    <div style={{ display: "flex", gap: "1rem", padding: "1rem" }}>
      <TabTrigger active={active === "inbox"} onClick={() => setActive("inbox")} badge={5}>
        Inbox
      </TabTrigger>
      <TabTrigger active={active === "archive"} onClick={() => setActive("archive")} badge={0}>
        Archive
      </TabTrigger>
      <TabTrigger active={active === "spam"} onClick={() => setActive("spam")} badge={12}>
        Spam
      </TabTrigger>
    </div>
  );
}

/** With badge counts. */
export const WithBadge: Story = {
  render: () => <WithBadgeExample />,
};

function IconAll() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <circle cx="4" cy="4" r="2" />
      <circle cx="12" cy="4" r="2" />
      <circle cx="4" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

function IconActive() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <circle cx="8" cy="8" r="6" />
    </svg>
  );
}

function IconArchive() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M2 4h12M3 4v9a1 1 0 001 1h6a1 1 0 001-1V4M6 7v4M10 7v4" />
    </svg>
  );
}

function WithLeadingIconExample() {
  const [active, setActive] = useState<string>("all");

  return (
    <div style={{ display: "flex", gap: "1rem", padding: "1rem" }}>
      <TabTrigger
        active={active === "all"}
        onClick={() => setActive("all")}
        leadingIcon={<IconAll />}
      >
        All
      </TabTrigger>
      <TabTrigger
        active={active === "active"}
        onClick={() => setActive("active")}
        leadingIcon={<IconActive />}
      >
        Active
      </TabTrigger>
      <TabTrigger
        active={active === "archive"}
        onClick={() => setActive("archive")}
        leadingIcon={<IconArchive />}
      >
        Archive
      </TabTrigger>
    </div>
  );
}

/** With leading icons. */
export const WithLeadingIcon: Story = {
  render: () => <WithLeadingIconExample />,
};

function DisabledExample() {
  const [active, setActive] = useState<string>("enabled");

  return (
    <div style={{ display: "flex", gap: "1rem", padding: "1rem" }}>
      <TabTrigger active={active === "enabled"} onClick={() => setActive("enabled")}>
        Enabled
      </TabTrigger>
      <TabTrigger active={false} onClick={() => {}} disabled>
        Disabled
      </TabTrigger>
      <TabTrigger active={false} onClick={() => {}} disabled badge={3}>
        Disabled with Badge
      </TabTrigger>
    </div>
  );
}

/** Disabled state. */
export const Disabled: Story = {
  render: () => <DisabledExample />,
};

/** Single trigger (minimal example). */
export const Single: Story = {
  render: () => (
    <div style={{ padding: "1rem" }}>
      <TabTrigger active={true} onClick={() => {}}>
        Selected
      </TabTrigger>
    </div>
  ),
};

function IconInbox() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M2 4h12v8a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" />
      <path d="M2 4l1.5-1.5A1 1 0 015 2h6a1 1 0 01.5.5L14 4" />
    </svg>
  );
}

/** With leading icon and badge (notification/inbox pattern). */
export const WithBadgeAndIcon: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "Combined leadingIcon + badge commonly used for inbox and notification tab patterns. Icon appears left of label, badge count right. Both can be optional.",
      },
    },
  },
  render: () => <WithBadgeAndIconExample />,
};

function WithBadgeAndIconExample() {
  const [active, setActive] = useState<string>("inbox");
  return (
    <div style={{ display: "flex", gap: "1rem", padding: "1rem" }}>
      <TabTrigger
        active={active === "inbox"}
        onClick={() => setActive("inbox")}
        leadingIcon={<IconInbox />}
        badge={12}
      >
        Inbox
      </TabTrigger>
      <TabTrigger
        active={active === "drafts"}
        onClick={() => setActive("drafts")}
        leadingIcon={<IconInbox />}
        badge={0}
      >
        Drafts
      </TabTrigger>
      <TabTrigger
        active={active === "sent"}
        onClick={() => setActive("sent")}
        leadingIcon={<IconInbox />}
      >
        Sent
      </TabTrigger>
    </div>
  );
}

/** Long label showing truncation/wrapping behaviour. */
export const LongLabelOverflow: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "Documents how TabTrigger handles unusually long labels: ellipsis truncation at a fixed max-width prevents layout shift and keeps tab bar responsive.",
      },
    },
  },
  render: () => <LongLabelOverflowExample />,
};

function LongLabelOverflowExample() {
  const [active, setActive] = useState<string>("short");
  return (
    <div style={{ display: "flex", gap: "1rem", padding: "1rem", maxWidth: 500 }}>
      <TabTrigger active={active === "short"} onClick={() => setActive("short")}>
        Short
      </TabTrigger>
      <TabTrigger active={active === "long"} onClick={() => setActive("long")}>
        This is a very long label that might wrap or truncate
      </TabTrigger>
      <TabTrigger active={active === "medium"} onClick={() => setActive("medium")}>
        Medium length label here
      </TabTrigger>
    </div>
  );
}
