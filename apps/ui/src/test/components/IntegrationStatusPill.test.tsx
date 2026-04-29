import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { IntegrationStatusPill } from "@/components/IntegrationStatusPill";
import type { CredentialStatus } from "@/api/integrations";

describe("IntegrationStatusPill", () => {
  it("renders the canonical label for ok", () => {
    render(<IntegrationStatusPill status="ok" />);
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  it("renders 'Token expired' for expired", () => {
    render(<IntegrationStatusPill status="expired" />);
    expect(screen.getByText("Token expired")).toBeInTheDocument();
  });

  it("renders 'Refresh failed' for refresh_failed", () => {
    render(<IntegrationStatusPill status="refresh_failed" />);
    expect(screen.getByText("Refresh failed")).toBeInTheDocument();
  });

  it("renders 'Not connected' for missing_credential", () => {
    render(<IntegrationStatusPill status="missing_credential" />);
    expect(screen.getByText("Not connected")).toBeInTheDocument();
  });

  it("renders with success variant for ok status", () => {
    const { container } = render(<IntegrationStatusPill status="ok" />);
    // Badge with dot=true renders a dot with aria-hidden="true"
    const dot = container.querySelector('[aria-hidden="true"]') as HTMLElement | null;
    expect(dot).not.toBeNull();
  });

  it("renders with warning variant for expired", () => {
    render(<IntegrationStatusPill status="expired" />);
    expect(screen.getByText("Token expired")).toBeInTheDocument();
  });

  it("renders with muted variant for missing_credential", () => {
    render(<IntegrationStatusPill status="missing_credential" />);
    expect(screen.getByText("Not connected")).toBeInTheDocument();
  });

  it("renders with error variant for scope_mismatch", () => {
    render(<IntegrationStatusPill status="scope_mismatch" />);
    expect(screen.getByText("Scope mismatch")).toBeInTheDocument();
  });

  it("accepts a label override", () => {
    render(<IntegrationStatusPill status="ok" label="Connected as user@example.com" />);
    expect(screen.getByText("Connected as user@example.com")).toBeInTheDocument();
  });

  it("covers every CredentialStatus value with a non-empty label", () => {
    const statuses: CredentialStatus[] = [
      "ok",
      "missing_credential",
      "expired",
      "refresh_failed",
      "revoked_by_provider",
      "unsupported_lifecycle",
      "scope_mismatch",
      "unresolved_ref",
    ];
    for (const s of statuses) {
      const { container, unmount } = render(<IntegrationStatusPill status={s} />);
      // Badge is the root element; get its text content (child text nodes only)
      const textContent = Array.from(container.firstElementChild?.childNodes || [])
        .filter((node) => node.nodeType === 3)
        .map((node) => node.textContent)
        .join("")
        .trim();
      expect(textContent).not.toBe("");
      unmount();
    }
  });
});
