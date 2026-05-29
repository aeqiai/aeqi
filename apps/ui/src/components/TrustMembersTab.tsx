import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ExternalLink, UserPlus, UsersRound } from "lucide-react";
import { api } from "@/lib/api";
import { entityPathFromId } from "@/lib/entityPath";
import { formatMediumDate } from "@/lib/i18n";
import type { Role, RoleInvitation } from "@/lib/types";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import {
  Badge,
  Button,
  EmptyState,
  Loading,
  PrimitivePageHeader,
  PrimitiveSearchField,
  Table,
  type TableColumn,
} from "./ui";
import "@/styles/members.css";

type MemberStatus = "active" | "invited" | "accepted" | "no_role";

interface MemberRow {
  id: string;
  name: string;
  detail: string;
  status: MemberStatus;
  roleIds: string[];
  roles: string[];
  createdAt: string | null;
  avatarUrl?: string | null;
}

const STATUS_LABEL: Record<MemberStatus, string> = {
  active: "Active",
  invited: "Invited",
  accepted: "Accepted",
  no_role: "No role",
};

const STATUS_VARIANT: Record<MemberStatus, "success" | "info" | "neutral" | "muted"> = {
  active: "success",
  invited: "info",
  accepted: "neutral",
  no_role: "muted",
};

export default function TrustMembersTab({ trustId }: { trustId: string }) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const entities = useDaemonStore((s) => s.entities);
  const [roles, setRoles] = useState<Role[]>([]);
  const [invitations, setInvitations] = useState<RoleInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function loadMembers() {
      const rolesResp = await api.getRoles(trustId);
      let invitationRows: RoleInvitation[] = [];

      if (user?.id) {
        const grantsResp = await api
          .getUserGrants(trustId, user.id)
          .catch(() => ({ ok: false, grants: [] }));
        if (canManageInvitations(grantsResp.grants)) {
          const invitationsResp = await api
            .listEntityInvitations(trustId)
            .catch(() => ({ ok: false, invitations: [] }));
          invitationRows = invitationsResp.invitations ?? [];
        }
      }

      return { roles: rolesResp.roles ?? [], invitations: invitationRows };
    }

    loadMembers()
      .then(({ roles, invitations }) => {
        if (cancelled) return;
        setRoles(roles);
        setInvitations(invitations);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message || "Could not load members.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [trustId, user?.id]);

  const roleTitleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const role of roles) m.set(role.id, role.title);
    return m;
  }, [roles]);

  const rows = useMemo(
    () => buildMemberRows({ roles, invitations, roleTitleById, trustId, user }),
    [roles, invitations, roleTitleById, trustId, user],
  );

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const haystack = [
        row.name,
        row.detail,
        STATUS_LABEL[row.status],
        ...row.roles,
        ...row.roleIds,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, query]);

  const inviteTargetRole = useMemo(
    () => roles.find((role) => role.occupant_kind === "vacant") ?? null,
    [roles],
  );
  const handleInviteHuman = useCallback(() => {
    if (inviteTargetRole) {
      navigate(
        entityPathFromId(
          entities,
          trustId,
          "roles",
          encodeURIComponent(inviteTargetRole.id),
          "invite",
        ),
      );
      return;
    }
    navigate(entityPathFromId(entities, trustId, "roles", "new"));
  }, [entities, inviteTargetRole, navigate, trustId]);

  const columns = useMemo<Array<TableColumn<MemberRow>>>(
    () => [
      {
        key: "member",
        header: "Member",
        width: "38%",
        sortable: true,
        sortAccessor: (row) => row.name,
        cell: (row) => <MemberIdentity row={row} />,
      },
      {
        key: "status",
        header: "Status",
        width: "130px",
        sortable: true,
        sortAccessor: (row) => STATUS_LABEL[row.status],
        cell: (row) => (
          <Badge variant={STATUS_VARIANT[row.status]} size="sm" dot>
            {STATUS_LABEL[row.status]}
          </Badge>
        ),
      },
      {
        key: "roles",
        header: "Roles",
        sortable: true,
        sortAccessor: (row) => roleList(row.roles),
        cell: (row) => <span className="trust-members-muted">{roleList(row.roles) || "None"}</span>,
      },
      {
        key: "created",
        header: "Since",
        width: "140px",
        sortable: true,
        sortAccessor: (row) => row.createdAt,
        cell: (row) => (
          <span className="trust-members-date">
            {row.createdAt ? formatMediumDate(row.createdAt, { fallback: "Unknown" }) : "Unknown"}
          </span>
        ),
      },
      {
        key: "open",
        header: "",
        width: "96px",
        align: "end",
        cell: (row) =>
          row.roleIds[0] ? (
            <Button
              variant="ghost"
              size="sm"
              trailingIcon={<ExternalLink size={13} strokeWidth={1.8} />}
              trailingIconMode="inline"
              onClick={() => navigate(entityPathFromId(entities, trustId, "roles", row.roleIds[0]))}
            >
              Role
            </Button>
          ) : null,
      },
    ],
    [entities, navigate, trustId],
  );

  const showEmpty = !loading && !error && rows.length === 0;
  const showNoMatch = !loading && !error && rows.length > 0 && filteredRows.length === 0;

  return (
    <div className="trust-members">
      <PrimitivePageHeader
        className="trust-members-page-header"
        title={
          <span className="trust-primitive-page-title">
            <span className="trust-primitive-page-title-text">Members</span>
            <span className="trust-primitive-page-count" aria-hidden="true">
              {rows.length}
            </span>
          </span>
        }
        aria-label="Member controls"
        actions={
          <Button
            className="trust-top-rail-cta"
            variant="primary"
            size="md"
            onClick={handleInviteHuman}
            disabled={loading}
            title={
              inviteTargetRole
                ? `Invite a human to ${inviteTargetRole.title}`
                : "Create a role before inviting a human"
            }
            leadingIcon={<UserPlus size={14} strokeWidth={1.8} />}
          >
            Invite human
          </Button>
        }
      >
        <div className="ideas-toolbar trust-members-toolbar">
          <PrimitiveSearchField
            placeholder="Search members"
            value={query}
            onChange={setQuery}
            onEscapeEmpty={(e) => e.currentTarget.blur()}
          />
        </div>
      </PrimitivePageHeader>

      <main className="trust-members-main">
        <section className="trust-members-register" aria-label="Members">
          {loading && (
            <div className="trust-members-state">
              <Loading size="sm" /> Loading members...
            </div>
          )}
          {error && <div className="trust-members-state trust-members-state--error">{error}</div>}
          {showEmpty && (
            <div className="trust-members-state">
              <EmptyState
                title="No members yet"
                description="Human members will appear here when they hold roles or receive invitations."
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => navigate(entityPathFromId(entities, trustId, "roles"))}
                  >
                    Open roles
                  </Button>
                }
              />
            </div>
          )}
          {showNoMatch && (
            <div className="trust-members-state">
              <EmptyState
                title="No members match this search."
                action={
                  <Button variant="ghost" size="sm" onClick={() => setQuery("")}>
                    Clear search
                  </Button>
                }
              />
            </div>
          )}
          {!loading && !error && filteredRows.length > 0 && (
            <>
              <div className="trust-members-table">
                <Table
                  columns={columns}
                  data={filteredRows}
                  rowKey={(row) => row.id}
                  density="compact"
                  stickyHeader
                  scrollWidth="md"
                  ariaLabel="Trust members"
                  defaultSort={{ key: "member", dir: "asc" }}
                />
              </div>
              <div className="trust-members-card-list" aria-label="Trust members">
                {filteredRows.map((row) => (
                  <article className="trust-members-card" key={row.id}>
                    <div className="trust-members-card-main">
                      <MemberIdentity row={row} />
                      <Badge variant={STATUS_VARIANT[row.status]} size="sm" dot>
                        {STATUS_LABEL[row.status]}
                      </Badge>
                    </div>
                    <dl className="trust-members-card-meta">
                      <div>
                        <dt>Roles</dt>
                        <dd>{roleList(row.roles) || "None"}</dd>
                      </div>
                      <div>
                        <dt>Since</dt>
                        <dd>
                          {row.createdAt
                            ? formatMediumDate(row.createdAt, { fallback: "Unknown" })
                            : "Unknown"}
                        </dd>
                      </div>
                    </dl>
                    {row.roleIds[0] && (
                      <Button
                        variant="ghost"
                        size="sm"
                        trailingIcon={<ExternalLink size={13} strokeWidth={1.8} />}
                        trailingIconMode="inline"
                        onClick={() =>
                          navigate(entityPathFromId(entities, trustId, "roles", row.roleIds[0]))
                        }
                      >
                        Role
                      </Button>
                    )}
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

function MemberIdentity({ row }: { row: MemberRow }) {
  return (
    <div className="trust-member-identity">
      <span className="trust-member-avatar" aria-hidden="true">
        {row.avatarUrl ? (
          <img src={row.avatarUrl} alt="" />
        ) : (
          <UsersRound size={15} strokeWidth={1.8} />
        )}
      </span>
      <span className="trust-member-copy">
        <span className="trust-member-name">{row.name}</span>
        <span className="trust-member-detail">{row.detail}</span>
      </span>
    </div>
  );
}

function buildMemberRows({
  roles,
  invitations,
  roleTitleById,
  trustId,
  user,
}: {
  roles: Role[];
  invitations: RoleInvitation[];
  roleTitleById: Map<string, string>;
  trustId: string;
  user: {
    id?: string;
    email?: string;
    name?: string;
    avatar_url?: string;
    roots?: string[];
    entities?: string[];
  } | null;
}): MemberRow[] {
  const byHumanId = new Map<string, MemberRow>();

  for (const role of roles) {
    if (role.occupant_kind !== "human" || !role.occupant_id) continue;
    const existing = byHumanId.get(role.occupant_id);
    if (existing) {
      existing.roleIds.push(role.id);
      existing.roles.push(role.title);
      if (role.created_at < (existing.createdAt ?? role.created_at))
        existing.createdAt = role.created_at;
      continue;
    }
    byHumanId.set(role.occupant_id, {
      id: `human:${role.occupant_id}`,
      name: role.occupant_name || "Human member",
      detail: role.occupant_id,
      status: "active",
      roleIds: [role.id],
      roles: [role.title],
      createdAt: role.created_at,
      avatarUrl: role.occupant_avatar_url,
    });
  }

  const rows = [...byHumanId.values()];

  if (user?.id && hasTrustAccess(user, trustId) && !byHumanId.has(user.id)) {
    rows.push({
      id: `human:${user.id}:self`,
      name: user.name || user.email || "You",
      detail: user.email || user.id,
      status: "no_role",
      roleIds: [],
      roles: [],
      createdAt: null,
      avatarUrl: user.avatar_url,
    });
  }

  for (const invitation of invitations) {
    if (invitation.declined_at || isExpired(invitation.expires_at)) continue;

    const roleTitle = roleTitleById.get(invitation.role_id) ?? "Role";
    if (invitation.redeemed_at) {
      if (invitation.redeemed_by_user_id && byHumanId.has(invitation.redeemed_by_user_id)) continue;
      rows.push({
        id: `accepted:${invitation.token}`,
        name:
          invitation.target_email || invitation.redeemed_by_user_id || acceptedTarget(invitation),
        detail: invitation.redeemed_by_user_id || "Accepted invitation",
        status: "accepted",
        roleIds: [invitation.role_id],
        roles: [roleTitle],
        createdAt: invitation.redeemed_at,
      });
      continue;
    }

    rows.push({
      id: `invite:${invitation.token}`,
      name: invitationTarget(invitation),
      detail: invitation.email_sent === false ? "Invitation not emailed" : "Pending invitation",
      status: "invited",
      roleIds: [invitation.role_id],
      roles: [roleTitle],
      createdAt: invitation.created_at,
    });
  }

  return rows.sort((a, b) => {
    const statusRank: Record<MemberStatus, number> = {
      active: 0,
      no_role: 1,
      invited: 2,
      accepted: 3,
    };
    return statusRank[a.status] - statusRank[b.status] || a.name.localeCompare(b.name);
  });
}

function hasTrustAccess(user: { roots?: string[]; entities?: string[] }, trustId: string): boolean {
  return !!trustId && (user.roots?.includes(trustId) || user.entities?.includes(trustId) || false);
}

function canManageInvitations(grants: string[]): boolean {
  return grants.includes("*") || grants.includes("roles.manage");
}

function invitationTarget(invitation: RoleInvitation): string {
  if (invitation.target_kind === "email") return invitation.target_email || "Email invite";
  if (invitation.target_kind === "slug") return invitation.target_entity_id || "Named invite";
  return "Open invite";
}

function acceptedTarget(invitation: RoleInvitation): string {
  if (invitation.target_email) return invitation.target_email;
  if (invitation.target_entity_id) return invitation.target_entity_id;
  return "Accepted member";
}

function isExpired(expiresAt: string): boolean {
  const time = Date.parse(expiresAt);
  return Number.isFinite(time) && time <= Date.now();
}

function roleList(roles: string[]): string {
  return roles.length > 0 ? roles.join(", ") : "";
}
