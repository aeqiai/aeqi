import type { Meta, StoryObj } from "@storybook/react";
import SessionRail, { type SessionRailRow } from "./SessionRail";

const meta: Meta<typeof SessionRail> = {
  title: "Primitives/Conversation/SessionRail",
  component: SessionRail,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Universal session rail — the left-adjacent index column for every conversation surface (inbox, agent sessions, future channels). Owns row grouping + memoization + j/k traversal bridge. Search / sort / filter live ABOVE the rail in `<SessionsToolbar>`; the rail itself is pure presentation over the rows the parent passes in.",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof SessionRail>;

const SAMPLE_ROWS: SessionRailRow[] = [
  {
    id: "s-1",
    primary: "AEQI deploy postmortem",
    time: "5m",
    status: "active",
    awaiting: true,
    group: "today",
    sortKey: 5,
  },
  {
    id: "s-2",
    primary: "Wallet upgrade flow review",
    time: "1h",
    status: "idle",
    group: "today",
    sortKey: 4,
  },
  {
    id: "s-3",
    primary: "Roles graph layout — tidy-tree pass",
    time: "3h",
    status: "idle",
    group: "today",
    sortKey: 3,
  },
  {
    id: "s-4",
    primary: "Bridge stabilization — chain spec note",
    time: "Yesterday",
    status: "idle",
    group: "yesterday",
    sortKey: 2,
  },
  {
    id: "s-5",
    primary: "Founder briefing — competitive scan",
    time: "May 4",
    status: "idle",
    group: "older",
    sortKey: 1,
  },
];

/* ── Default — full row list ── */
export const Default: Story = {
  name: "Default",
  args: {
    rows: SAMPLE_ROWS,
    selectedId: "s-1",
    onSelect: () => {},
    emptyTitle: "no sessions yet",
  },
  render: (args) => (
    <div style={{ width: 360, height: 480, background: "var(--color-card-subtle)" }}>
      <SessionRail {...args} />
    </div>
  ),
};

/* ── Filtered — caller has narrowed rows via `<SessionsToolbar>` query ── */
const SEARCH_NARROWED = SAMPLE_ROWS.filter((r) => r.primary.toLowerCase().includes("aeqi"));

export const Filtered: Story = {
  name: "Filtered by toolbar query",
  args: {
    rows: SEARCH_NARROWED,
    selectedId: "s-1",
    onSelect: () => {},
    emptyTitle: "no sessions yet",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Caller (MeInboxPage / shell SessionsRail) has filtered the row list down before passing it in. The rail renders the narrowed set verbatim. Search lives in `<SessionsToolbar>` mounted above; this story documents the post-filter shape.",
      },
    },
  },
  render: (args) => (
    <div style={{ width: 360, height: 480, background: "var(--color-card-subtle)" }}>
      <SessionRail {...args} />
    </div>
  ),
};

/* ── Empty — parent passed zero rows ── */
export const Empty: Story = {
  name: "Empty",
  args: {
    rows: [],
    selectedId: null,
    onSelect: () => {},
    emptyTitle: "inbox is clear",
    emptyHint: "decisions and replies your agents need will land here.",
  },
  render: (args) => (
    <div style={{ width: 360, height: 480, background: "var(--color-card-subtle)" }}>
      <SessionRail {...args} />
    </div>
  ),
};
