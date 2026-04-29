import type { CredentialStatus } from "@/api/integrations";
import { statusLabel } from "@/api/integrations";
import { Badge, type BadgeVariant } from "./ui/Badge";

/**
 * Status badge for credential status. Thin wrapper around Badge
 * that maps CredentialStatus to design system variants and renders with a dot.
 * Supports optional label override.
 */
function credentialStatusToVariant(status: CredentialStatus): BadgeVariant {
  switch (status) {
    case "ok":
      return "success";
    case "expired":
    case "refresh_failed":
      return "warning";
    case "missing_credential":
    case "revoked_by_provider":
      return "muted";
    case "scope_mismatch":
    case "unsupported_lifecycle":
    case "unresolved_ref":
      return "error";
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
  const variant = credentialStatusToVariant(status);
  const displayLabel = label ?? statusLabel(status);

  return (
    <Badge variant={variant} dot className="integration-status-pill">
      {displayLabel}
    </Badge>
  );
}
