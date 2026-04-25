import type { CredentialStatus } from "@/api/integrations";
import { statusLabel } from "@/api/integrations";

/**
 * Small dot + label representing a credential's reason code, mapped to
 * design system v4 colors:
 *
 * | reason code              | dot color                  |
 * | ------------------------ | -------------------------- |
 * | ok                       | jade (`--success`)         |
 * | expired / refresh_failed | amber (`--warning`)        |
 * | revoked_by_provider      | near-black (`--text-muted`)|
 * | missing_credential       | near-black (`--text-muted`)|
 * | scope_mismatch           | red (`--error`)            |
 * | unsupported_lifecycle    | red (`--error`)            |
 * | unresolved_ref           | red (`--error`)            |
 */
function statusDotColor(status: CredentialStatus): string {
  switch (status) {
    case "ok":
      return "var(--success)";
    case "expired":
    case "refresh_failed":
      return "var(--warning)";
    case "missing_credential":
    case "revoked_by_provider":
      return "var(--text-muted)";
    case "scope_mismatch":
    case "unsupported_lifecycle":
    case "unresolved_ref":
      return "var(--error)";
  }
}

export function IntegrationStatusPill({
  status,
  label,
}: {
  status: CredentialStatus;
  /** Optional override — falls back to the canonical label for the code. */
  label?: string;
}) {
  return (
    <span
      className="integration-status-pill"
      role="status"
      aria-label={`Status: ${label ?? statusLabel(status)}`}
    >
      <span
        className="integration-status-dot"
        aria-hidden="true"
        style={{ background: statusDotColor(status) }}
      />
      <span className="integration-status-label">{label ?? statusLabel(status)}</span>
    </span>
  );
}
