import type { Meta, StoryObj } from "@storybook/react";
import { ArrowDownAZ, Filter } from "lucide-react";
import { Button } from "./Button";
import { PrimitivePageHeader } from "./PrimitivePageHeader";
import { PrimitiveSearchField } from "./PrimitiveSearchField";

const meta: Meta<typeof PrimitivePageHeader> = {
  title: "Primitives/Layout/PrimitivePageHeader",
  component: PrimitivePageHeader,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Header for primitive app surfaces such as Quests, Ideas, and Roles. It standardizes the first row: title, search chrome, modifiers, and actions.",
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

export const WithSearchChrome: Story = {
  args: {
    title: "Quests",
    children: (
      <div className="ideas-toolbar">
        <PrimitiveSearchField placeholder="Search quests" value="" onChange={() => undefined} />
        <button type="button" className="ideas-toolbar-btn" aria-label="Sort">
          <ArrowDownAZ size={15} strokeWidth={1.7} aria-hidden />
        </button>
        <button type="button" className="ideas-toolbar-btn" aria-label="Filter">
          <Filter size={15} strokeWidth={1.7} aria-hidden />
        </button>
      </div>
    ),
    actions: (
      <Button variant="primary" size="md">
        New
      </Button>
    ),
  },
};

export const ObjectScopeChip: Story = {
  args: {
    title: "Chief of Staff",
    titleVariant: "chip",
    actions: (
      <Button variant="secondary" size="md">
        Open
      </Button>
    ),
  },
};
