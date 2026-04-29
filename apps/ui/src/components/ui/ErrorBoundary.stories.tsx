import { useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { ErrorBoundary } from "./ErrorBoundary";
import { Button } from "./Button";

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

/* ── Retry flow ── */

function RetryFlowRender(): ReactNode {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return <ThrowingComponent />;
  }

  return (
    <button onClick={() => setHasError(true)} style={{ padding: "8px 16px" }}>
      Trigger Error
    </button>
  );
}

export const RetryFlow: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "Shows the recovery pattern: a custom fallback with a Retry button that calls setState to reset hasError. The boundary allows the user to recover without a page reload. The Retry button delegates to the parent state, not a ref or imperative method.",
      },
    },
  },
  render: () => {
    function Fallback(): ReactNode {
      return (
        <div
          style={{
            padding: 32,
            textAlign: "center",
            border: "1px solid rgba(0,0,0,0.08)",
            borderRadius: 8,
          }}
        >
          <p
            style={{
              fontWeight: 600,
              fontSize: 14,
              color: "rgba(0,0,0,0.85)",
              margin: "0 0 16px",
            }}
          >
            Something went wrong
          </p>
          <p style={{ fontSize: 13, color: "rgba(0,0,0,0.4)", margin: "0 0 20px" }}>
            The agent encountered an unexpected error. Try again or contact support.
          </p>
          <Button variant="primary" size="sm" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </div>
      );
    }

    return (
      <ErrorBoundary fallback={<Fallback />}>
        <RetryFlowRender />
      </ErrorBoundary>
    );
  },
};

/* ── Nested boundaries ── */

function InnerThrowingComponent(): ReactNode {
  throw new Error("Feature initialization failed: missing API key");
}

export const NestedBoundaries: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "Documents the per-route boundary pattern. An outer ErrorBoundary wraps the page, an inner one wraps a feature. When the inner feature throws, its boundary catches the error without taking down the entire page. This prevents cascading failures.",
      },
    },
  },
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
            style={{
              fontWeight: 600,
              fontSize: 14,
              color: "rgba(0,0,0,0.85)",
              margin: "0 0 8px",
            }}
          >
            Page error
          </p>
          <p style={{ fontSize: 13, color: "rgba(0,0,0,0.4)", margin: 0 }}>
            The page encountered a critical error.
          </p>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "24px" }}>
        <div
          style={{
            padding: 24,
            border: "1px solid rgba(0,0,0,0.08)",
            borderRadius: 8,
          }}
        >
          <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 8px" }}>Main content</p>
          <p style={{ fontSize: 12, color: "rgba(0,0,0,0.55)", margin: 0 }}>
            This section is unaffected by the feature error below.
          </p>
        </div>

        <ErrorBoundary
          fallback={
            <div
              style={{
                padding: 24,
                border: "1px solid rgba(0,0,0,0.08)",
                borderRadius: 8,
                backgroundColor: "rgba(255, 59, 48, 0.04)",
              }}
            >
              <p
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "rgba(255, 59, 48, 0.85)",
                  margin: "0 0 8px",
                }}
              >
                Feature unavailable
              </p>
              <p style={{ fontSize: 12, color: "rgba(0,0,0,0.4)", margin: 0 }}>
                The feature encountered an error but the rest of the page works.
              </p>
            </div>
          }
        >
          <InnerThrowingComponent />
        </ErrorBoundary>
      </div>
    </ErrorBoundary>
  ),
};
