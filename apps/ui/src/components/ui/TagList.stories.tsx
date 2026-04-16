import type { Meta, StoryObj } from "@storybook/react";
import { TagList } from "./TagList";

const meta: Meta<typeof TagList> = {
  title: "Components/TagList",
  component: TagList,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof TagList>;

/* ── Agent expertise tags ── */

export const AgentExpertise: Story = {
  name: "Agent Expertise",
  args: {
    items: ["typescript", "react", "code-review", "testing"],
  },
};

/* ── Idea tags ── */

export const IdeaTags: Story = {
  name: "Idea Tags",
  args: {
    items: ["skill", "deployment", "security", "best-practice"],
  },
};

/* ── Quest labels ── */

export const QuestLabels: Story = {
  name: "Quest Labels",
  args: {
    items: ["frontend", "urgent", "refactor"],
  },
};

/* ── Single tag ── */

export const SingleTag: Story = {
  name: "Single Tag",
  args: {
    items: ["identity"],
  },
};

/* ── Empty states ── */

export const Empty: Story = {
  args: {
    items: [],
  },
};

export const EmptyWithFallback: Story = {
  name: "Empty with Fallback Text",
  args: {
    items: [],
    empty: "No tags assigned",
  },
};

/* ── Many tags ── */

export const ManyTags: Story = {
  name: "Many Tags (Wrapping)",
  args: {
    items: [
      "typescript",
      "react",
      "rust",
      "devops",
      "kubernetes",
      "security",
      "testing",
      "documentation",
      "code-review",
      "ci-cd",
    ],
  },
};
