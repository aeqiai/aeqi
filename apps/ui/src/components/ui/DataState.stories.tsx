import type { Meta, StoryObj } from "@storybook/react";
import { DataState } from "./DataState";
import { StatusBadge } from "./Badge";

const meta: Meta<typeof DataState> = {
  title: "Feedback/DataState",
  component: DataState,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof DataState>;

/* ── Loading states ── */

export const Loading: Story = {
  args: {
    loading: true,
    empty: false,
    children: <div>Content</div>,
  },
};

export const LoadingQuests: Story = {
  name: "Loading Quests",
  render: () => (
    <DataState loading={true} empty={false} loadingText="Fetching quests...">
      <div>Content</div>
    </DataState>
  ),
};

export const LoadingAgents: Story = {
  name: "Loading Agents",
  render: () => (
    <DataState loading={true} empty={false} loadingText="Connecting to agents...">
      <div>Content</div>
    </DataState>
  ),
};

/* ── Empty states ── */

export const EmptyQuests: Story = {
  name: "Empty Quest List",
  args: {
    loading: false,
    empty: true,
    emptyTitle: "No quests found",
    emptyDescription: "Create a quest to assign work to your agents.",
    children: <div>Content</div>,
  },
};

export const EmptyEvents: Story = {
  name: "Empty Event Stream",
  args: {
    loading: false,
    empty: true,
    emptyTitle: "No events recorded",
    emptyDescription: "Events will appear here once your agents start running.",
    children: <div>Content</div>,
  },
};

/* ── Content state: Quest list ── */

export const QuestList: Story = {
  name: "Loaded Quest List",
  args: {
    loading: false,
    empty: false,
    children: (
      <div style={{ display: "flex", flexDirection: "column" }}>
        {[
          { name: "Refactor auth module", status: "in_progress" },
          { name: "Write migration script", status: "pending" },
          { name: "Deploy v0.5.0", status: "blocked" },
          { name: "Update API docs", status: "done" },
        ].map((q, i) => (
          <div
            key={q.name}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px",
              borderTop: i > 0 ? "1px solid rgba(0,0,0,0.06)" : undefined,
            }}
          >
            <span style={{ fontSize: 13, color: "rgba(0,0,0,0.85)" }}>{q.name}</span>
            <StatusBadge status={q.status} size="sm" />
          </div>
        ))}
      </div>
    ),
  },
};

/* ── Full lifecycle: loading -> empty -> content ── */

export const FullLifecycle: Story = {
  name: "State Lifecycle",
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 32, maxWidth: 400 }}>
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
          1. Loading
        </p>
        <div
          style={{
            border: "1px solid rgba(0,0,0,0.08)",
            borderRadius: 8,
            padding: 16,
          }}
        >
          <DataState loading={true} empty={false} loadingText="Fetching ideas...">
            <div />
          </DataState>
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
          2. Empty
        </p>
        <div
          style={{
            border: "1px solid rgba(0,0,0,0.08)",
            borderRadius: 8,
            padding: 16,
          }}
        >
          <DataState
            loading={false}
            empty={true}
            emptyTitle="No ideas yet"
            emptyDescription="Store knowledge for your agents."
          >
            <div />
          </DataState>
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
          3. Content
        </p>
        <div
          style={{
            border: "1px solid rgba(0,0,0,0.08)",
            borderRadius: 8,
            padding: 16,
          }}
        >
          <DataState loading={false} empty={false}>
            <div style={{ fontSize: 13, color: "rgba(0,0,0,0.85)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <strong>deployment-checklist</strong>
                <span style={{ fontSize: 11, color: "rgba(0,0,0,0.35)" }}>idea</span>
              </div>
              <p style={{ color: "rgba(0,0,0,0.55)", margin: 0 }}>
                Pre-deployment verification steps for the production environment.
              </p>
            </div>
          </DataState>
        </div>
      </div>
    </div>
  ),
};
