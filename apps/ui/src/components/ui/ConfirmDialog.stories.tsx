import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { ConfirmDialog } from "./ConfirmDialog";
import { Button } from "./Button";

const meta: Meta<typeof ConfirmDialog> = {
  title: "Primitives/Overlays/ConfirmDialog",
  component: ConfirmDialog,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
};

export default meta;
type Story = StoryObj<typeof ConfirmDialog>;

function ConfirmDialogDemo({
  destructive = false,
  loading = false,
}: {
  destructive?: boolean;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant={destructive ? "danger" : "primary"} onClick={() => setOpen(true)}>
        {destructive ? "Revoke Session" : "Confirm Invite"}
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={() => setOpen(false)}
        title={destructive ? "Revoke Session" : "Confirm Invite"}
        message={
          destructive
            ? "This device will be signed out immediately and must authenticate again."
            : "The invite will be accepted and the company workspace will open."
        }
        confirmLabel={destructive ? "Revoke" : "Confirm"}
        destructive={destructive}
        loading={loading}
      />
    </>
  );
}

export const Default: Story = {
  render: () => <ConfirmDialogDemo />,
};

export const Destructive: Story = {
  render: () => <ConfirmDialogDemo destructive />,
};

export const Loading: Story = {
  render: () => <ConfirmDialogDemo destructive loading />,
};
