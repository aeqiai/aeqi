import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { GRANT_CATALOG } from "@/lib/grants";
import type { Role, RoleInvitation } from "@/lib/types";
import { Badge, Button, Spinner } from "@/components/ui";

const ROLE_TYPE_LABEL: Record<string, string> = {
  director: "Director",
  operational: "Operational",
  advisor: "Advisor",
};

function grantLabel(id: string): string {
  return GRANT_CATALOG.find((g) => g.id === id)?.label ?? id;
}

export default function RoleDetailPage() {
  const { entityId = "", roleId = "" } = useParams<{ entityId: string; roleId: string }>();
  const navigate = useNavigate();

  const [role, setRole] = useState<Role | null>(null);
  const [invitations, setInvitations] = useState<RoleInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  useEffect(() => {
    if (!roleId) return;
    document.title = "Role · æqi";
    setLoading(true);
    setError(null);

    Promise.all([
      api.getRole(roleId),
      api.listEntityInvitations(entityId).catch(() => ({ ok: false, invitations: [] })),
    ])
      .then(([roleResp, invResp]) => {
        setRole(roleResp.role);
        document.title = `${roleResp.role.title || "Role"} · æqi`;
        const roleInvitations = invResp.invitations.filter((i) => i.role_id === roleId);
        setInvitations(roleInvitations);
      })
      .catch((e: Error) => {
        setError(e.message || "Could not load role.");
      })
      .finally(() => setLoading(false));
  }, [entityId, roleId]);

  const handleArchive = async () => {
    if (!role) return;
    setArchiving(true);
    try {
      await api.archiveRole(roleId);
      navigate(`/c/${encodeURIComponent(entityId)}/roles`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not archive role.");
      setArchiving(false);
    }
  };

  const backHref = `/c/${encodeURIComponent(entityId)}/roles`;
  const editHref = `/c/${encodeURIComponent(entityId)}/roles/${encodeURIComponent(roleId)}/edit`;
  const inviteHref = `/c/${encodeURIComponent(entityId)}/roles/${encodeURIComponent(roleId)}/invite`;

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "28px 32px",
          color: "var(--text-muted)",
          fontSize: 13,
        }}
      >
        <Spinner size="sm" /> Loading…
      </div>
    );
  }

  if (error || !role) {
    return (
      <div className="asv-main" style={{ padding: "28px 32px" }}>
        <div style={{ color: "var(--color-error, #c2410c)", fontSize: 13 }}>
          {error || "Role not found."}
        </div>
        <Link to={backHref} style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          Back to Roles
        </Link>
      </div>
    );
  }

  const pendingInvitations = invitations.filter(
    (i) => !i.redeemed_at && !i.declined_at && i.expires_at > new Date().toISOString(),
  );

  return (
    <div className="asv-main" style={{ padding: "28px 32px", maxWidth: 680 }}>
      <div className="page-header">
        <div className="page-header-breadcrumbs">
          <Link to={backHref}>Roles</Link>
          <span>/</span>
          <span>{role.title || "(untitled)"}</span>
        </div>
        <div className="page-header-row">
          <div
            style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", minWidth: 0 }}
          >
            <h1 className="page-title" style={{ marginBottom: 0 }}>
              {role.title || <em style={{ color: "var(--text-muted)" }}>(untitled)</em>}
            </h1>
            {role.founder && (
              <Badge variant="muted" size="sm">
                Founder
              </Badge>
            )}
            <Badge variant="muted" size="sm">
              {ROLE_TYPE_LABEL[role.role_type] ?? role.role_type}
            </Badge>
          </div>
          <div className="page-header-actions">
            <Button variant="secondary" size="sm" onClick={() => navigate(editHref)}>
              Edit
            </Button>
            <Button variant="secondary" size="sm" onClick={handleArchive} loading={archiving}>
              Archive
            </Button>
          </div>
        </div>
      </div>

      {/* Holder section */}
      <section style={{ marginBottom: "var(--space-8)" }}>
        <h2
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: "var(--space-3)",
          }}
        >
          Holder
        </h2>
        {role.occupant_kind === "vacant" ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "16px 18px",
              background: "var(--color-card)",
              borderRadius: "var(--radius-md)",
            }}
          >
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              Vacant — no one holds this role yet.
            </span>
            <Button variant="primary" size="sm" onClick={() => navigate(inviteHref)}>
              Invite someone
            </Button>
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 18px",
              background: "var(--color-card-elevated, #fff)",
              borderRadius: "var(--radius-md)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 999,
                  background: "var(--accent)",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: 600,
                  flexShrink: 0,
                }}
                aria-hidden
              >
                {(role.occupant_id ?? "?").slice(0, 1).toUpperCase()}
              </div>
              <span>
                <span style={{ display: "block", fontSize: 13, fontWeight: 500, lineHeight: 1.4 }}>
                  {role.occupant_id ?? "(unknown)"}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {role.occupant_kind}
                </span>
              </span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate(inviteHref)}>
              Reassign
            </Button>
          </div>
        )}
      </section>

      {/* Authority section */}
      <section style={{ marginBottom: "var(--space-8)" }}>
        <h2
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: "var(--space-3)",
          }}
        >
          Authority
        </h2>
        {role.grants.length === 0 ? (
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>No grants assigned.</span>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
            {role.grants.map((g) => (
              <span
                key={g}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "3px 10px",
                  borderRadius: 999,
                  background: "var(--color-card)",
                  fontSize: 12,
                  fontWeight: 500,
                  color: "var(--text-secondary)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {grantLabel(g)}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Pending invitations */}
      {pendingInvitations.length > 0 && (
        <section style={{ marginBottom: "var(--space-8)" }}>
          <h2
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: "var(--space-3)",
            }}
          >
            Pending Invitations
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {pendingInvitations.map((inv) => (
              <InvitationRow
                key={inv.token}
                invitation={inv}
                onCancelled={() => {
                  setInvitations((prev) => prev.filter((i) => i.token !== inv.token));
                }}
              />
            ))}
          </div>
        </section>
      )}

      {error && (
        <div
          style={{
            fontSize: 13,
            color: "var(--color-error, #c2410c)",
            marginTop: "var(--space-4)",
          }}
          role="alert"
        >
          {error}
        </div>
      )}
    </div>
  );
}

function InvitationRow({
  invitation,
  onCancelled,
}: {
  invitation: RoleInvitation;
  onCancelled: () => void;
}) {
  const [cancelling, setCancelling] = useState(false);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await api.declineInvitation(invitation.token);
      onCancelled();
    } catch {
      setCancelling(false);
    }
  };

  const expiresAt = new Date(invitation.expires_at).toLocaleDateString();
  const target =
    invitation.target_kind === "email"
      ? (invitation.target_email ?? "—")
      : invitation.target_kind === "open"
        ? "Open link"
        : (invitation.target_entity_id ?? "—");

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 14px",
        background: "var(--color-card)",
        borderRadius: "var(--radius-md)",
        gap: "var(--space-3)",
      }}
    >
      <div>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{target}</span>
        <span
          style={{
            display: "block",
            fontSize: 11,
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {invitation.token.slice(0, 12)}… · expires {expiresAt}
        </span>
      </div>
      <Button variant="ghost" size="sm" onClick={handleCancel} loading={cancelling}>
        Cancel
      </Button>
    </div>
  );
}
