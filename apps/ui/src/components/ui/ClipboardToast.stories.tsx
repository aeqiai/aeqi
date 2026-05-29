import type { Meta, StoryObj } from "@storybook/react";
import { ClipboardToast } from "./ClipboardToast";

const meta: Meta<typeof ClipboardToast> = {
  title: "Primitives/Feedback/ClipboardToast",
  component: ClipboardToast,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Fixed bottom-right clipboard confirmation for quiet copy actions. The caller owns the timer and count.",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof ClipboardToast>;

export const CopiedOnce: Story = {
  args: { label: "+1 copied" },
};

export const CopiedBatch: Story = {
  args: { label: "+3 copied" },
};
