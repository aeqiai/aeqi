import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { PrimitiveSearchField } from "./PrimitiveSearchField";

const meta: Meta<typeof PrimitiveSearchField> = {
  title: "Primitives/Inputs/PrimitiveSearchField",
  component: PrimitiveSearchField,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Canonical search field for primitive surface toolbars. It emits the shared Ideas/Quests/Roles search chrome and owns Escape-to-clear behavior.",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof PrimitiveSearchField>;

function SearchDemo() {
  const [value, setValue] = useState("");
  return (
    <div className="ideas-list-head">
      <div className="ideas-toolbar">
        <PrimitiveSearchField
          placeholder="Search roles"
          value={value}
          onChange={setValue}
          showKbdHint
        />
      </div>
    </div>
  );
}

export const ToolbarSearch: Story = {
  render: () => <SearchDemo />,
};
