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
          "Universal session rail — the left-adjacent index column for every conversation surface (inbox, agent sessions, future channels). Owns its own search input + filter + recencyBucket grouping + j/k traversal bridge. Adopters pass row data; the rail renders, filters, and selects.",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof SessionRail>;

const SAMPLE_ROWS: SessionRailRow[] = [
  {
    id: "s-1",
    primary: "AEIQ deploy postmortem",
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

/* ── Default — full row list, search empty ── */
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

/* ── Active query — rows filtered by case-insensitive substring match ──
 * The "with-search-active" canonical story: query in input, rows
 * narrowed to the matching subset. Storybook Controls cannot pre-seed
 * the rail's internal `query` state, so this story documents the shape
 * via a smaller pre-filtered row set + typed-in placeholder. The
 * runtime behaviour is verified in the Default story by typing into
 * the input.
 */
const SEARCH_NARROWED = SAMPLE_ROWS.filter((r) => r.primary.toLowerCase().includes("aeiq"));

export const WithSearchActive: Story = {
  name: "with-search-active",
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
          "Rows filtered to a single match — emulates the post-query state by passing only the matching row. The live primitive narrows internally on every keystroke against `row.primary` (and `row.secondary` if present); empty matches render a `no matches` empty state.",
      },
    },
  },
  render: (args) => (
    <div style={{ width: 360, height: 480, background: "var(--color-card-subtle)" }}>
      <SessionRail {...args} />
    </div>
  ),
};

/* ── Search disabled — opt-out via enableSearch prop ── */
export const SearchDisabled: Story = {
  name: "Search disabled",
  args: {
    rows: SAMPLE_ROWS,
    selectedId: "s-2",
    onSelect: () => {},
    emptyTitle: "no sessions yet",
    enableSearch: false,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Adopter opt-out via `enableSearch={false}`. The search input is suppressed; the rail renders the row list directly. Both shipping adopters (MeInboxPage, shell/SessionsRail) keep the default `true`.",
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
