import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { ErrorBoundary } from "./ErrorBoundary";

const meta: Meta<typeof ErrorBoundary> = {
  title: "Primitives/Feedback/ErrorBoundary",
  component: ErrorBoundary,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof ErrorBoundary>;

function ThrowingComponent(): ReactNode {
  throw new Error("Agent runtime connection failed: ECONNREFUSED 127.0.0.1:8400");
}

/* ── Default error ── */

export const DefaultFallback: Story = {
  name: "Default Error Fallback",
  render: () => (
    <ErrorBoundary>
      <ThrowingComponent />
    </ErrorBoundary>
  ),
};

/* ── Custom fallback ── */

export const CustomFallback: Story = {
  name: "Custom Error Fallback",
  render: () => (
    <ErrorBoundary
      fallback={
        <div
          style={{
            padding: 32,
            textAlign: "center",
            border: "1px solid rgba(0,0,0,0.08)",
            borderRadius: 8,
          }}
        >
          <p
            style={{ fontWeight: 600, fontSize: 14, color: "rgba(0,0,0,0.85)", margin: "0 0 8px" }}
          >
            Failed to load agent panel
          </p>
          <p style={{ fontSize: 13, color: "rgba(0,0,0,0.4)", margin: 0 }}>
            The agent runtime may be offline. Check your daemon connection in Settings.
          </p>
        </div>
      }
    >
      <ThrowingComponent />
    </ErrorBoundary>
  ),
};

/* ── No error (normal rendering) ── */

export const NoError: Story = {
  name: "Successful Render",
  render: () => (
    <ErrorBoundary>
      <div
        style={{
          padding: 24,
          border: "1px solid rgba(0,0,0,0.08)",
          borderRadius: 8,
          textAlign: "center",
        }}
      >
        <p style={{ fontSize: 13, color: "rgba(0,0,0,0.55)", margin: 0 }}>
          This component rendered successfully. The error boundary is transparent when no error
          occurs.
        </p>
      </div>
    </ErrorBoundary>
  ),
};
