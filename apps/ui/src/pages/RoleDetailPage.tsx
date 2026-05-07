import { useMemo, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { GRANT_CATALOG } from "@/lib/grants";
import type { Role, RoleInvitation } from "@/lib/types";
import { useDaemonStore } from "@/store/daemon";
import { entityPathFromId } from "@/lib/entityPath";
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

  const agents = useDaemonStore((s) => s.agents);
  const entitiesList = useDaemonStore((s) => s.entities);
  const agentNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents) m.set(a.id, a.name);
    return m;
  }, [agents]);

  useEffect(() => {
    if (!roleId) return;
    document.title = "Role · æiq";
    setLoading(true);
    setError(null);

    Promise.all([
      api.getRole(roleId),
      api.listEntityInvitations(entityId).catch(() => ({ ok: false, invitations: [] })),
    ])
      .then(([roleResp, invResp]) => {
        setRole(roleResp.role);
        document.title = `${roleResp.role.title || "Role"} · æiq`;
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
      navigate(entityPathFromId(entitiesList, entityId, "roles"), { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not archive role.");
      setArchiving(false);
    }
  };

  const backHref = entityPathFromId(entitiesList, entityId, "roles");
  const editHref = entityPathFromId(
    entitiesList,
    entityId,
    "roles",
    encodeURIComponent(roleId),
    "edit",
  );
  const inviteHref = entityPathFromId(
    entitiesList,
    entityId,
    "roles",
    encodeURIComponent(roleId),
    "invite",
  );

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "var(--space-6) var(--space-8)",
          color: "var(--color-text-muted)",
          fontSize: "var(--font-size-sm)",
        }}
      >
        <Spinner size="sm" /> Loading…
      </div>
    );
  }

  if (error || !role) {
    return (
      <div className="asv-main" style={{ padding: "var(--space-6) var(--space-8)" }}>
        <div style={{ color: "var(--color-error)", fontSize: "var(--font-size-sm)" }}>
          {error || "Role not found."}
        </div>
        <Link
          to={backHref}
          style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-secondary)" }}
        >
          Back to Roles
        </Link>
      </div>
    );
  }

  const pendingInvitations = invitations.filter(
    (i) => !i.redeemed_at && !i.declined_at && i.expires_at > new Date().toISOString(),
  );

  return (
    <div className="asv-main" style={{ padding: "var(--space-6) var(--space-8)", maxWidth: 680 }}>
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
              {role.title || <em style={{ color: "var(--color-text-muted)" }}>(untitled)</em>}
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
            <Button variant="danger" size="sm" onClick={handleArchive} loading={archiving}>
              Archive
            </Button>
          </div>
        </div>
      </div>

      {/* Holder section */}
      <section style={{ marginBottom: "var(--space-8)" }}>
        <h2
          style={{
            fontSize: "var(--font-size-xs)",
            fontWeight: 600,
            color: "var(--color-text-muted)",
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
              padding: "var(--space-4) var(--space-5)",
              background: "var(--color-card)",
              borderRadius: "var(--radius-md)",
            }}
          >
            <span style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-secondary)" }}>
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
              padding: "var(--space-4) var(--space-5)",
              background: "var(--color-card-elevated)",
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
                  color: "var(--color-text-on-accent)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "var(--font-size-sm)",
                  fontWeight: 600,
                  flexShrink: 0,
                }}
                aria-hidden
              >
                {getOccupantDisplay(role.occupant_id, agentNames, role.occupant_name)
                  .slice(0, 1)
                  .toUpperCase()}
              </div>
              <span>
                <span
                  style={{
                    display: "block",
                    fontSize: "var(--font-size-sm)",
                    fontWeight: 500,
                    lineHeight: 1.4,
                  }}
                >
                  {getOccupantDisplay(role.occupant_id, agentNames, role.occupant_name)}
                </span>
                <span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
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
            fontSize: "var(--font-size-xs)",
            fontWeight: 600,
            color: "var(--color-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: "var(--space-3)",
          }}
        >
          Authority
        </h2>
        {role.grants.length === 0 ? (
          <span style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)" }}>
            No grants assigned.
          </span>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
            {role.grants.map((g) => (
              <span
                key={g}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "var(--space-0) var(--space-2)",
                  borderRadius: 999,
                  background: "var(--color-card)",
                  fontSize: "var(--font-size-xs)",
                  fontWeight: 500,
                  color: "var(--color-text-secondary)",
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
              fontSize: "var(--font-size-xs)",
              fontWeight: 600,
              color: "var(--color-text-muted)",
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
            fontSize: "var(--font-size-sm)",
            color: "var(--color-error)",
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

  const emailNotSent = invitation.email_sent === false;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "var(--space-2) var(--space-4)",
        background: "var(--color-card)",
        borderRadius: "var(--radius-md)",
        gap: "var(--space-3)",
      }}
    >
      <div>
        <span style={{ fontSize: "var(--font-size-sm)", fontWeight: 500 }}>{target}</span>
        <span
          style={{
            display: "block",
            fontSize: "var(--font-size-xs)",
            color: "var(--color-text-muted)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {invitation.token.slice(0, 12)}… · expires {expiresAt}
          {emailNotSent && (
            <span
              style={{
                marginLeft: "var(--space-2)",
                color: "var(--color-text-secondary)",
                fontFamily: "inherit",
                fontStyle: "italic",
              }}
            >
              · invite not sent
            </span>
          )}
        </span>
      </div>
      <div style={{ display: "flex", gap: "var(--space-1)", alignItems: "center" }}>
        {emailNotSent && (
          <Button
            variant="secondary"
            size="sm"
            type="button"
            disabled
            title="Send invite (coming soon)"
          >
            Send invite
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={handleCancel} loading={cancelling}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function getOccupantDisplay(
  occupantId: string | null,
  agentNames: Map<string, string>,
  occupantName?: string | null,
): string {
  if (!occupantId) return "Unoccupied";
  // Prefer platform-resolved display name for human occupants.
  if (occupantName) return occupantName;
  const agentName = agentNames.get(occupantId);
  if (agentName) return agentName;
  // Fallback: truncated id suffix.
  return `${occupantId.slice(0, 4)}…${occupantId.slice(-4)}`;
}
