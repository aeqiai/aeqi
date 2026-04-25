import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IntegrationCard } from "@/components/IntegrationCard";
import type { CredentialView, IntegrationCatalogEntry } from "@/api/integrations";

const googleEntry: IntegrationCatalogEntry = {
  provider: "google",
  name: "oauth_token",
  label: "Google Workspace",
  description: "Gmail / Calendar / Meet",
  lifecycle_kind: "oauth2",
  auth_url: "https://accounts.google.com/o/oauth2/v2/auth",
  token_url: "https://oauth2.googleapis.com/token",
  revoke_url: "https://oauth2.googleapis.com/revoke",
  oauth_scopes: ["https://www.googleapis.com/auth/gmail.modify"],
  client_id_env: "AEQI_OAUTH_GOOGLE_CLIENT_ID",
  client_secret_env: "AEQI_OAUTH_GOOGLE_CLIENT_SECRET",
  per_agent: true,
  coming_soon: false,
};

const githubEntry: IntegrationCatalogEntry = {
  ...googleEntry,
  provider: "github",
  label: "GitHub",
  description: "Issues + PRs",
  oauth_scopes: ["repo"],
  coming_soon: true,
};

function makeCredential(overrides?: Partial<CredentialView>): CredentialView {
  return {
    id: "cred-1",
    scope_kind: "agent",
    scope_id: "agent-1",
    provider: "google",
    name: "oauth_token",
    lifecycle_kind: "oauth2",
    status: "ok",
    account_email: "user@example.com",
    expires_at: "2030-01-01T00:00:00Z",
    created_at: "2025-01-01T00:00:00Z",
    last_refreshed_at: null,
    last_used_at: null,
    granted_scopes: ["https://www.googleapis.com/auth/gmail.modify"],
    ...overrides,
  };
}

describe("IntegrationCard", () => {
  it("shows Connect when no credential exists", () => {
    const onConnect = vi.fn();
    render(
      <IntegrationCard
        entry={googleEntry}
        credentials={[]}
        onConnect={onConnect}
        onRefresh={vi.fn()}
        onDisconnect={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: "Connect" });
    fireEvent.click(button);
    expect(onConnect).toHaveBeenCalledOnce();
  });

  it("shows Refresh + Disconnect when credential is ok", () => {
    const onRefresh = vi.fn();
    const onDisconnect = vi.fn();
    render(
      <IntegrationCard
        entry={googleEntry}
        credentials={[makeCredential({ status: "ok" })]}
        onConnect={vi.fn()}
        onRefresh={onRefresh}
        onDisconnect={onDisconnect}
      />,
    );
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("user@example.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(onRefresh).toHaveBeenCalledWith("cred-1");
    expect(onDisconnect).toHaveBeenCalledWith("cred-1");
  });

  it("shows Reconnect when credential is expired", () => {
    render(
      <IntegrationCard
        entry={googleEntry}
        credentials={[makeCredential({ status: "expired" })]}
        onConnect={vi.fn()}
        onRefresh={vi.fn()}
        onDisconnect={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeInTheDocument();
    expect(screen.getByText("Token expired")).toBeInTheDocument();
  });

  it("disables CTA and shows 'Coming soon' for unavailable packs", () => {
    render(
      <IntegrationCard
        entry={githubEntry}
        credentials={[]}
        onConnect={vi.fn()}
        onRefresh={vi.fn()}
        onDisconnect={vi.fn()}
      />,
    );
    expect(screen.getByText("Coming soon")).toBeInTheDocument();
    const cta = screen.getByRole("button", { name: "Available later" });
    expect(cta).toBeDisabled();
  });

  it("ignores credentials for other providers", () => {
    // A github credential shouldn't show up on the google card.
    const githubCred = makeCredential({ provider: "github", id: "cred-other" });
    render(
      <IntegrationCard
        entry={googleEntry}
        credentials={[githubCred]}
        onConnect={vi.fn()}
        onRefresh={vi.fn()}
        onDisconnect={vi.fn()}
      />,
    );
    // Google card with a github credential = looks like nothing is connected.
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });
});
