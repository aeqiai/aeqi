import type { Meta, StoryObj } from "@storybook/react";
import { StatusPill } from "./StatusPill";

const meta: Meta<typeof StatusPill> = {
  title: "Primitives/Data Display/StatusPill",
  component: StatusPill,
  tags: ["autodocs"],
  argTypes: {
    tone: {
      control: "select",
      options: ["neutral", "success", "progress", "review", "warning", "error", "info", "muted"],
    },
    size: {
      control: "select",
      options: ["sm", "md"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof StatusPill>;

export const Online: Story = {
  args: {
    children: "Online",
    tone: "success",
  },
};

export const Invited: Story = {
  args: {
    children: "Invited",
    tone: "review",
  },
};

export const Offline: Story = {
  args: {
    children: "Offline",
    tone: "muted",
  },
};

export const Medium: Story = {
  args: {
    children: "In progress",
    tone: "progress",
    size: "md",
  },
};
