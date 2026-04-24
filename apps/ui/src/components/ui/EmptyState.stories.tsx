import type { Meta, StoryObj } from "@storybook/react";
import { EmptyState } from "./EmptyState";
import { Button } from "./Button";

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
