import type { Meta, StoryObj } from "@storybook/react";
import { Banner } from "./Banner";

const meta: Meta<typeof Banner> = {
  title: "Primitives/Feedback/Banner",
  component: Banner,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Banner>;

export const Success: Story = {
  args: {
    kind: "success",
    children: "Profile updated.",
  },
};

export const ErrorBanner: Story = {
  name: "Error",
  args: {
    kind: "error",
    children: "Could not update profile. Try again.",
  },
};

export const Warning: Story = {
  args: {
    kind: "warning",
    children: "This action requires re-authentication. Sign in again to continue.",
  },
};

export const Info: Story = {
  args: {
    kind: "info",
    children: "Email preferences are coming soon.",
  },
};
