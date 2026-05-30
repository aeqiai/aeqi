import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import SessionsToolbar from "./SessionsToolbar";

const meta: Meta<typeof SessionsToolbar> = {
  title: "Primitives/Conversation/SessionsToolbar",
  component: SessionsToolbar,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Canonical toolbar for every conversation surface that mounts a `<SessionRail>`: search + sort + filter, in the chrome zone above the row list. Search is mandatory; sort and filter are slot-based so each surface owns its own domain semantics while sharing the same chrome.",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof SessionsToolbar>;

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ width: 400, background: "var(--color-card-subtle)", padding: 0 }}>{children}</div>
  );
}

function FakePopoverButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="ideas-toolbar-btn"
      aria-label={label}
      title={label}
      style={{ pointerEvents: "none" }}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 13 13"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        aria-hidden
      >
        <path d="M2 3.25h9M3.5 6.5h6M5 9.75h3" />
      </svg>
    </button>
  );
}

/* ── Default — search only, no sort/filter slots (agent surface shape) ── */

function SearchOnlyDemo() {
  const [q, setQ] = useState("");
  return (
    <Wrap>
      <SessionsToolbar query={q} onQuery={setQ} searchPlaceholder="Search sessions" />
    </Wrap>
  );
}

export const Default: Story = {
  name: "Search only",
  render: () => <SearchOnlyDemo />,
  parameters: {
    docs: {
      description: {
        story:
          "Agent-surface composition — search field plus magnifier glyph + `/` keyboard hint, no sort/filter popover slots. Typing into the input narrows the rail rows below it via the parent's filter state.",
      },
    },
  },
};

/* ── With sort + filter slots ── */

function WithSortAndFilterDemo() {
  const [q, setQ] = useState("");
  return (
    <Wrap>
      <SessionsToolbar
        query={q}
        onQuery={setQ}
        searchPlaceholder="Search sessions"
        sort={<FakePopoverButton label="Sort" />}
        filter={<FakePopoverButton label="Filter" />}
      />
    </Wrap>
  );
}

export const WithSortAndFilter: Story = {
  name: "With sort + filter",
  render: () => <WithSortAndFilterDemo />,
  parameters: {
    docs: {
      description: {
        story:
          "Search plus two glyph buttons for a surface-owned sort and filter. Storybook stubs them as plain buttons because the popover open state isn't useful in isolation.",
      },
    },
  },
};

/* ── Active query — clear-x button visible, kbd hint hidden ── */

function ActiveQueryDemo() {
  const [q, setQ] = useState("aeqi");
  return (
    <Wrap>
      <SessionsToolbar query={q} onQuery={setQ} searchPlaceholder="Search sessions" />
    </Wrap>
  );
}

export const ActiveQuery: Story = {
  name: "Active query",
  render: () => <ActiveQueryDemo />,
  parameters: {
    docs: {
      description: {
        story:
          "Search field with an active query — the `/`-key hint hides and a clear-× button appears on the right. Pressing × or Escape clears the query.",
      },
    },
  },
};
