import type { Meta, StoryObj } from "@storybook/react";
import { ProgressList } from "./ProgressList";

const meta: Meta<typeof ProgressList> = {
  title: "Primitives/Feedback/ProgressList",
  component: ProgressList,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
};

export default meta;
type Story = StoryObj<typeof ProgressList>;

export const Running: Story = {
  args: {
    steps: [
      { key: "identity", label: "Identity confirmed", status: "done" },
      { key: "wallet", label: "Preparing account wallet", status: "active" },
      { key: "session", label: "Securing session", status: "pending" },
      { key: "workspace", label: "Opening workspace", status: "pending" },
    ],
  },
};

export const Complete: Story = {
  args: {
    steps: [
      { key: "creating", label: "Creating TRUST", status: "done" },
      { key: "signing", label: "Registering on Solana", status: "done" },
      { key: "roles", label: "Activating roles", status: "done" },
      { key: "runtime", label: "Starting runtime", status: "done" },
    ],
  },
};

export const Failed: Story = {
  args: {
    steps: [
      { key: "creating", label: "Creating TRUST", status: "done" },
      { key: "signing", label: "Registering on Solana", status: "done" },
      { key: "roles", label: "Activating roles", status: "error" },
      { key: "runtime", label: "Starting runtime", status: "pending" },
    ],
  },
};
