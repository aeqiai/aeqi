import type { Meta, StoryObj } from "@storybook/react";
import { StatusRow } from "./StatusRow";
import { Button } from "./Button";

const meta: Meta<typeof StatusRow> = {
  title: "Primitives/Feedback/StatusRow",
  component: StatusRow,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof StatusRow>;

export const ActiveDotWithAction: Story = {
  name: "Active dot + action",
  args: {
    dot: "active",
    label: "Authenticator app enabled",
    action: (
      <Button variant="secondary" size="sm">
        Disable
      </Button>
    ),
  },
};

export const IdleDotWithToggle: Story = {
  name: "Idle dot + toggle",
  args: {
    dot: "idle",
    label: "Analytics off",
    action: (
      <Button variant="secondary" size="sm">
        Turn on
      </Button>
    ),
  },
};

const GoogleMark = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" style={{ display: "block" }}>
    <path
      d="M21.6 12.227c0-.715-.064-1.403-.184-2.064H12v3.905h5.382a4.6 4.6 0 0 1-1.996 3.018v2.51h3.232c1.892-1.742 2.982-4.305 2.982-7.369z"
      fill="#4285F4"
    />
    <path
      d="M12 22c2.7 0 4.964-.895 6.618-2.423l-3.232-2.51c-.895.6-2.04.955-3.386.955-2.605 0-4.81-1.76-5.596-4.123H3.064v2.59A9.996 9.996 0 0 0 12 22z"
      fill="#34A853"
    />
    <path
      d="M6.404 13.9A6.01 6.01 0 0 1 6.09 12c0-.66.114-1.3.314-1.9V7.51H3.064A9.997 9.997 0 0 0 2 12c0 1.614.386 3.14 1.064 4.49l3.34-2.59z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.977c1.468 0 2.786.505 3.823 1.495l2.868-2.867C16.96 3.001 14.696 2 12 2 8.09 2 4.713 4.246 3.064 7.51l3.34 2.59c.787-2.363 2.99-4.123 5.596-4.123z"
      fill="#EA4335"
    />
  </svg>
);

export const ProviderRowConnected: Story = {
  name: "Provider row — connected",
  args: {
    icon: <GoogleMark />,
    label: "Google",
    status: "Connected",
  },
};

export const ProviderRowDisconnected: Story = {
  name: "Provider row — disconnected",
  args: {
    icon: <GoogleMark />,
    label: "Google",
    action: (
      <Button variant="secondary" size="sm">
        Connect
      </Button>
    ),
  },
};
