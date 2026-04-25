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

  it("uses jade dot for ok status", () => {
    const { container } = render(<IntegrationStatusPill status="ok" />);
    const dot = container.querySelector(".integration-status-dot") as HTMLElement | null;
    expect(dot).not.toBeNull();
    // var(--success) maps to jade in the design system.
    expect(dot?.style.background).toContain("--success");
  });

  it("uses warning amber for expired", () => {
    const { container } = render(<IntegrationStatusPill status="expired" />);
    const dot = container.querySelector(".integration-status-dot") as HTMLElement | null;
    expect(dot?.style.background).toContain("--warning");
  });

  it("uses muted neutral for missing_credential", () => {
    const { container } = render(<IntegrationStatusPill status="missing_credential" />);
    const dot = container.querySelector(".integration-status-dot") as HTMLElement | null;
    expect(dot?.style.background).toContain("--text-muted");
  });

  it("uses error red for scope_mismatch", () => {
    const { container } = render(<IntegrationStatusPill status="scope_mismatch" />);
    const dot = container.querySelector(".integration-status-dot") as HTMLElement | null;
    expect(dot?.style.background).toContain("--error");
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
      expect(container.querySelector(".integration-status-label")?.textContent || "").not.toBe("");
      unmount();
    }
  });
});
