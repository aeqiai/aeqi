import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./Button";
import { PrimitivePageHeader } from "./PrimitivePageHeader";

const meta: Meta<typeof PrimitivePageHeader> = {
  title: "Primitives/Layout/PrimitivePageHeader",
  component: PrimitivePageHeader,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Header for primitive app surfaces such as Quests, Ideas, and Roles. It standardizes the title/action row that sits directly above the search toolbar.",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof PrimitivePageHeader>;

export const Standard: Story = {
  args: {
    title: "Roles",
    actions: (
      <>
        <Button variant="secondary" size="md">
          Invite
        </Button>
        <Button variant="primary" size="md">
          New
        </Button>
      </>
    ),
  },
};

export const Embedded: Story = {
  args: {
    title: "Ideas",
    padding: "none",
    actions: (
      <Button variant="primary" size="sm">
        New
      </Button>
    ),
  },
};
