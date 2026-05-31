import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDownWideNarrow, ArrowUpRight, ListFilter, UserPlus } from "lucide-react";
import { api } from "@/lib/api";
import { entityPathFromId } from "@/lib/entityPath";
import { formatMediumDate } from "@/lib/i18n";
import type { Role, RoleInvitation } from "@/lib/types";
import { relativeTime } from "@/components/ideas/types";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import UserAvatar from "./UserAvatar";
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  Loading,
  PrimitivePageHeader,
  PrimitiveSearchField,
  Table,
  ToolbarRadioPopover,
  type TableColumn,
} from "./ui";
import {
  buildMemberRows,
  canManageInvitations,
  compareMemberRows,
  FILTER_LABELS,
  FILTER_ORDER,
  MEMBERS_PAGE_SIZE,
  authorityRoleLabel,
  roleList,
  SORT_LABELS,
  SORT_ORDER,
  STATUS_LABEL,
  type MemberRow,
  type MemberSortMode,
  type MemberStatus,
  type MemberStatusFilter,
} from "./members/memberRows";
import "@/styles/members.css";

const STATUS_VARIANT: Record<MemberStatus, "success" | "warning" | "neutral" | "muted"> = {
  active: "success",
  invited: "warning",
  accepted: "neutral",
  no_role: "muted",
};

export default function CompanyMembersTab({ companyId }: { companyId: string }) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const entities = useDaemonStore((s) => s.entities);
  const [roles, setRoles] = useState<Role[]>([]);
  const [invitations, setInvitations] = useState<RoleInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<MemberSortMode>("name");
  const [statusFilter, setStatusFilter] = useState<MemberStatusFilter>("all");
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function loadMembers() {
      const rolesResp = await api.getRoles(companyId);
      let invitationRows: RoleInvitation[] = [];

      if (user?.id) {
        const grantsResp = await api
          .getUserGrants(companyId, user.id)
          .catch(() => ({ ok: false, grants: [] }));
        if (canManageInvitations(grantsResp.grants)) {
          const invitationsResp = await api
            .listEntityInvitations(companyId)
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
  }, [companyId, user?.id]);

  const roleTitleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const role of roles) m.set(role.id, role.title);
    return m;
  }, [roles]);

  const rows = useMemo(
    () => buildMemberRows({ roles, invitations, roleTitleById, companyId, user }),
    [roles, invitations, roleTitleById, companyId, user],
  );

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const narrowed = rows.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (!q) return true;
      const haystack = [
        row.name,
        row.detail,
        STATUS_LABEL[row.status],
        authorityRoleLabel(row.authorityRole),
        ...row.roles,
        ...row.roleIds,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
    return narrowed.sort((a, b) => compareMemberRows(a, b, sort));
  }, [rows, query, sort, statusFilter]);

  useEffect(() => {
    const pageCount = Math.max(1, Math.ceil(filteredRows.length / MEMBERS_PAGE_SIZE));
    setPage((current) => Math.min(current, pageCount));
  }, [filteredRows.length]);

  const inviteTargetRole = useMemo(
    () => roles.find((role) => role.occupant_kind === "vacant") ?? null,
    [roles],
  );
  const handleInviteHuman = useCallback(() => {
    if (inviteTargetRole) {
      navigate(
        entityPathFromId(
          entities,
          companyId,
          "roles",
          encodeURIComponent(inviteTargetRole.id),
          "invite",
        ),
      );
      return;
    }
    navigate(entityPathFromId(entities, companyId, "roles", "new"));
  }, [entities, inviteTargetRole, navigate, companyId]);
  const openMemberRoles = useCallback(
    (row: MemberRow) => {
      if (row.roleIds.length === 0) return;
      if (row.roleIds.length === 1) {
        navigate(entityPathFromId(entities, companyId, "roles", row.roleIds[0]));
        return;
      }
      const params = new URLSearchParams();
      params.set("occupant", "human");
      params.set("q", row.detail);
      navigate(`${entityPathFromId(entities, companyId, "roles")}?${params.toString()}`);
    },
    [entities, navigate, companyId],
  );

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
        width: "112px",
        sortable: true,
        sortAccessor: (row) => STATUS_LABEL[row.status],
        cell: (row) => (
          <Badge
            variant={STATUS_VARIANT[row.status]}
            size="sm"
            dot
            className="company-members-status"
          >
            {STATUS_LABEL[row.status]}
          </Badge>
        ),
      },
      {
        key: "roles",
        header: "Role",
        width: "112px",
        sortable: true,
        sortAccessor: (row) => authorityRoleLabel(row.authorityRole),
        cell: (row) => <MemberRoleCell row={row} onOpen={openMemberRoles} />,
      },
      {
        key: "lastActive",
        header: "Last active",
        width: "124px",
        sortable: true,
        sortAccessor: (row) => (row.lastActive ? Date.parse(row.lastActive) : 0),
        cell: (row) => <LastActiveCell value={row.lastActive} />,
      },
      {
        key: "created",
        header: "Since",
        width: "140px",
        sortable: true,
        sortAccessor: (row) => row.createdAt,
        cell: (row) => (
          <span className="company-members-date">
            {row.createdAt ? formatMediumDate(row.createdAt, { fallback: "Unknown" }) : "Unknown"}
          </span>
        ),
      },
    ],
    [openMemberRoles],
  );

  const showEmpty = !loading && !error && rows.length === 0;
  const showNoMatch = !loading && !error && rows.length > 0 && filteredRows.length === 0;

  return (
    <div className="company-members">
      <PrimitivePageHeader
        className="company-members-page-header"
        title={
          <span className="company-primitive-page-title">
            <span className="company-primitive-page-title-text">Members</span>
            <span className="company-primitive-page-count" aria-hidden="true">
              {rows.length}
            </span>
          </span>
        }
        aria-label="Member controls"
        pinPlacement="utilities"
        actions={
          <Button
            className="company-top-rail-cta"
            variant="primary"
            size="md"
            onClick={handleInviteHuman}
            disabled={loading}
            title={
              inviteTargetRole
                ? `Invite a member to ${inviteTargetRole.title}`
                : "Create a role before inviting a member"
            }
            leadingIcon={<UserPlus size={14} strokeWidth={1.8} />}
          >
            Invite member
          </Button>
        }
      >
        <div className="ideas-toolbar company-members-toolbar">
          <PrimitiveSearchField
            placeholder="Search members"
            value={query}
            onChange={setQuery}
            showKbdHint
            onEscapeEmpty={(e) => e.currentTarget.blur()}
          />
          <ToolbarRadioPopover
            label="Sort"
            current={SORT_LABELS[sort]}
            glyph={<ArrowDownWideNarrow size={14} strokeWidth={1.8} />}
            options={SORT_ORDER.map((value) => ({ id: value, label: SORT_LABELS[value] }))}
            value={sort}
            onChange={(next) => setSort(next as MemberSortMode)}
          />
          <ToolbarRadioPopover
            label="Filter"
            current={FILTER_LABELS[statusFilter]}
            glyph={<ListFilter size={14} strokeWidth={1.8} />}
            options={FILTER_ORDER.map((value) => ({ id: value, label: FILTER_LABELS[value] }))}
            value={statusFilter}
            onChange={(next) => setStatusFilter(next as MemberStatusFilter)}
            indicator={statusFilter !== "all"}
          />
        </div>
      </PrimitivePageHeader>

      <main className="company-members-main">
        <section className="company-members-register" aria-label="Members">
          {loading && (
            <div className="company-members-state">
              <Loading size="sm" /> Loading members...
            </div>
          )}
          {error && (
            <div className="company-members-state company-members-state--error">{error}</div>
          )}
          {showEmpty && (
            <div className="company-members-state">
              <EmptyState
                title="No members yet"
                description="Human members will appear here when they hold roles or receive invitations."
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => navigate(entityPathFromId(entities, companyId, "roles"))}
                  >
                    Open roles
                  </Button>
                }
              />
            </div>
          )}
          {showNoMatch && (
            <div className="company-members-state">
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
              <div className="company-members-table">
                <Table
                  columns={columns}
                  data={filteredRows}
                  rowKey={(row) => row.id}
                  density="compact"
                  scrollWidth="sm"
                  ariaLabel="Company members"
                  pagination={{
                    page,
                    pageSize: MEMBERS_PAGE_SIZE,
                    total: filteredRows.length,
                    itemLabel: "members",
                    onPageChange: setPage,
                  }}
                />
              </div>
              <div className="company-members-card-list" aria-label="Company members">
                {filteredRows.map((row) => (
                  <article className="company-members-card" key={row.id}>
                    <div className="company-members-card-main">
                      <MemberIdentity row={row} />
                      <Badge
                        variant={STATUS_VARIANT[row.status]}
                        size="sm"
                        dot
                        className="company-members-status"
                      >
                        {STATUS_LABEL[row.status]}
                      </Badge>
                    </div>
                    <dl className="company-members-card-meta">
                      <div>
                        <dt>Role</dt>
                        <dd>
                          <MemberRoleCell row={row} onOpen={openMemberRoles} />
                        </dd>
                      </div>
                      <div>
                        <dt>Last active</dt>
                        <dd>
                          <LastActiveCell value={row.lastActive} />
                        </dd>
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
    <div className="company-member-identity">
      <span className="company-member-avatar" aria-hidden="true">
        <UserAvatar name={row.name} src={row.avatarUrl} size={28} />
      </span>
      <span className="company-member-copy">
        <span className="company-member-name">{row.name}</span>
        <span className="company-member-detail">{row.detail}</span>
      </span>
    </div>
  );
}

function MemberRoleCell({ row, onOpen }: { row: MemberRow; onOpen: (row: MemberRow) => void }) {
  const count = row.roleIds.length;
  const role = authorityRoleLabel(row.authorityRole);
  const label = count === 1 ? `Open ${row.roles[0] ?? "role"}` : `Open role for ${row.name}`;

  return (
    <span className="company-members-role-count-cell" title={roleList(row.roles)}>
      <span
        className={count > 0 ? "company-members-role-count" : "company-members-role-count muted"}
      >
        {role}
      </span>
      {count > 0 && (
        <IconButton
          aria-label={label}
          className="company-members-nav-action"
          size="sm"
          variant="ghost"
          title={label}
          onClick={(event) => {
            event.stopPropagation();
            onOpen(row);
          }}
        >
          <ArrowUpRight size={14} strokeWidth={1.8} />
        </IconButton>
      )}
    </span>
  );
}

function LastActiveCell({ value }: { value: string | null }) {
  const label = relativeTime(value ?? undefined);
  return (
    <span className={label ? "company-members-date" : "company-members-date company-members-muted"}>
      {label || "-"}
    </span>
  );
}
