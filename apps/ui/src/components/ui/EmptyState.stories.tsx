import { useState, useEffect, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { EmptyState } from "./EmptyState";
import { Button } from "./Button";
import { Spinner } from "./Spinner";

const meta: Meta<typeof EmptyState> = {
  title: "Primitives/Feedback/EmptyState",
  component: EmptyState,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof EmptyState>;

/* ── Primitive-specific empty states ── */

export const NoAgents: Story = {
  name: "No Agents",
  args: {
    title: "No agents found",
    description: "Define your first agent to start automating work.",
    action: (
      <Button variant="primary" size="sm">
        Create Agent
      </Button>
    ),
  },
};

export const NoQuests: Story = {
  name: "No Quests",
  args: {
    title: "No quests yet",
    description: "Create a quest to assign work to your agents.",
    action: (
      <Button variant="primary" size="sm">
        New Quest
      </Button>
    ),
  },
};

export const NoEvents: Story = {
  name: "No Events",
  args: {
    title: "No events recorded",
    description: "Events will appear here once your agents start running.",
  },
};

export const NoIdeas: Story = {
  name: "No Ideas",
  args: {
    title: "No ideas stored",
    description: "Ideas are knowledge, identity, and instructions for your agents.",
    action: (
      <Button variant="primary" size="sm">
        Store Idea
      </Button>
    ),
  },
};

/* ── Contextual empty states ── */

export const SearchNoResults: Story = {
  name: "Search No Results",
  args: {
    title: "No matching results",
    description: "Try adjusting your search terms or filters.",
  },
};

export const FilteredEmpty: Story = {
  name: "Filtered List Empty",
  args: {
    title: "No blocked quests",
    description: "All quests are progressing normally.",
  },
};

/* ── Minimal ── */

export const MinimalTitle: Story = {
  name: "Title Only",
  args: {
    title: "Nothing here",
  },
};

/* ── Loading to empty transition ── */

function LoadingToEmptyTransitionRender(): ReactNode {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => {
      setLoading((prev) => !prev);
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 24px",
        minHeight: 300,
      }}
    >
      {loading ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
          }}
        >
          <Spinner size="md" />
          <span style={{ fontSize: 13, color: "rgba(0,0,0,0.4)" }}>Loading quests...</span>
        </div>
      ) : (
        <EmptyState
          title="No quests yet"
          description="Create a quest to assign work to your agents."
          action={
            <Button variant="primary" size="sm">
              New Quest
            </Button>
          }
        />
      )}
    </div>
  );
}

export const LoadingToEmptyTransition: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "Documents the canonical fetch-to-empty pattern. Surfaces display a Spinner during data load, then transition to EmptyState when the request resolves with no results. This cycle repeats to showcase the transition. Most surfaces implement this manually; the story documents the sequence.",
      },
    },
  },
  render: () => <LoadingToEmptyTransitionRender />,
};

/* ── Secondary action ── */

export const WithSecondaryAction: Story = {
  name: "With Secondary Action",
  parameters: {
    docs: {
      description: {
        story:
          "EmptyState with two actions side-by-side: primary (create/add) and secondary (navigate/learn). The action prop accepts ReactNode; wrap two Buttons in a flex container. Common on onboarding surfaces.",
      },
    },
  },
  args: {
    title: "Create your first quest",
    description: "Quests assign work to agents and track progress.",
    action: (
      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        <Button variant="primary" size="sm">
          New Quest
        </Button>
        <Button variant="secondary" size="sm">
          Read the docs
        </Button>
      </div>
    ),
  },
};
