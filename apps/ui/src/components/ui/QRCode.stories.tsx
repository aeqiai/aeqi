import type { Meta, StoryObj } from "@storybook/react";
import { QRCode } from "./QRCode";
import { Card } from "./Card";
import { Stack } from "./Stack";
import { DetailField } from "./DetailField";

const meta: Meta<typeof QRCode> = {
  title: "Primitives/Data Display/QRCode",
  component: QRCode,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
  argTypes: {
    size: {
      control: { type: "range", min: 96, max: 280, step: 8 },
    },
    margin: {
      control: { type: "number", min: 0, max: 4 },
    },
    level: {
      control: "select",
      options: ["L", "M", "Q", "H"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof QRCode>;

export const TotpSecret: Story = {
  args: {
    value: "otpauth://totp/aeqi:founder@example.com?secret=JBSWY3DPEHPK3PXP&issuer=aeqi&period=30",
    size: 180,
    margin: 1,
    level: "M",
  },
};

export const InSecuritySetup: Story = {
  render: () => (
    <Card>
      <Stack gap="4">
        <QRCode
          value="otpauth://totp/aeqi:operator@example.com?secret=JBSWY3DPEHPK3PXP&issuer=aeqi&period=30"
          size={180}
        />
        <DetailField label="Method">Authenticator app</DetailField>
        <DetailField label="Refresh">30 seconds</DetailField>
      </Stack>
    </Card>
  ),
};
