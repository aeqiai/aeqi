import type { Meta, StoryObj } from "@storybook/react";
import { ArrowRight } from "lucide-react";
import { Button } from "./Button";
import {
  InspectorChips,
  InspectorField,
  InspectorHeader,
  InspectorPanel,
  InspectorSection,
} from "./InspectorPanel";

const meta: Meta<typeof InspectorPanel> = {
  title: "Primitives/Data Display/InspectorPanel",
  component: InspectorPanel,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof InspectorPanel>;

export const TrustRoleSelection: Story = {
  render: () => (
    <div style={{ width: 328, height: 620 }}>
      <InspectorPanel ariaLabel="Selected role">
        <InspectorHeader
          eyebrow="Selected role"
          title="Director"
          subtitle="aeqi · held by 53455"
          media={
            <span
              aria-hidden="true"
              style={{
                display: "inline-flex",
                width: 42,
                height: 42,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "var(--radius-sm)",
                background: "var(--bg-row)",
                color: "var(--color-text-primary)",
                fontSize: "var(--font-size-sm)",
                fontWeight: 650,
              }}
            >
              ae
            </span>
          }
          actions={
            <Button
              type="button"
              size="sm"
              variant="primary"
              trailingIcon={<ArrowRight size={13} strokeWidth={1.6} />}
            >
              Enter
            </Button>
          }
        />
        <InspectorSection title="Identity">
          <InspectorField label="Holder">53455</InspectorField>
          <InspectorField label="Trust">aeqi</InspectorField>
          <InspectorField label="Connection">Direct</InspectorField>
        </InspectorSection>
        <InspectorSection title="Authority">
          <InspectorChips>
            {["Quests", "Agents", "Events", "Review"].map((item) => (
              <span className="scope-chip" key={item}>
                {item}
              </span>
            ))}
          </InspectorChips>
        </InspectorSection>
      </InspectorPanel>
    </div>
  ),
};
