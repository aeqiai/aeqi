import type { Role, RoleInvitation } from "@/lib/types";

export type MemberStatus = "active" | "invited" | "accepted" | "no_role";
export type MemberSortMode = "name" | "recent" | "active" | "roles";
export type MemberStatusFilter = "all" | MemberStatus;
export type MemberAuthorityRole = "director" | "operator" | "advisor";

export interface MemberRow {
  id: string;
  name: string;
  detail: string;
  status: MemberStatus;
  roleIds: string[];
  roles: string[];
  authorityRole: MemberAuthorityRole | null;
  createdAt: string | null;
  lastActive: string | null;
  avatarUrl?: string | null;
}

export const MEMBERS_PAGE_SIZE = 25;

export const SORT_LABELS: Record<MemberSortMode, string> = {
  name: "Name",
  recent: "Recently added",
  active: "Last active",
  roles: "Role",
};
export const SORT_ORDER: MemberSortMode[] = ["name", "recent", "active", "roles"];

export const FILTER_LABELS: Record<MemberStatusFilter, string> = {
  all: "All",
  active: "Active",
  invited: "Invited",
  accepted: "Accepted",
  no_role: "No role",
};
export const FILTER_ORDER: MemberStatusFilter[] = [
  "all",
  "active",
  "invited",
  "accepted",
  "no_role",
];

export const STATUS_LABEL: Record<MemberStatus, string> = {
  active: "Active",
  invited: "Invited",
  accepted: "Accepted",
  no_role: "No role",
};

export function compareMemberRows(a: MemberRow, b: MemberRow, sort: MemberSortMode): number {
  switch (sort) {
    case "recent":
      return timestamp(b.createdAt) - timestamp(a.createdAt) || a.name.localeCompare(b.name);
    case "active":
      return timestamp(b.lastActive) - timestamp(a.lastActive) || a.name.localeCompare(b.name);
    case "roles":
      return (
        authorityRank(a.authorityRole) - authorityRank(b.authorityRole) ||
        a.name.localeCompare(b.name)
      );
    case "name":
    default:
      return a.name.localeCompare(b.name);
  }
}

export function buildMemberRows({
  roles,
  invitations,
  roleTitleById,
  companyId,
  user,
}: {
  roles: Role[];
  invitations: RoleInvitation[];
  roleTitleById: Map<string, string>;
  companyId: string;
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
      existing.authorityRole = strongestAuthorityRole(existing.authorityRole, roleAuthority(role));
      if (role.created_at < (existing.createdAt ?? role.created_at))
        existing.createdAt = role.created_at;
      existing.lastActive = latestTimestamp(existing.lastActive, role.occupant_last_active ?? null);
      continue;
    }
    byHumanId.set(role.occupant_id, {
      id: `human:${role.occupant_id}`,
      name: role.occupant_name || "Human member",
      detail: role.occupant_id,
      status: "active",
      roleIds: [role.id],
      roles: [role.title],
      authorityRole: roleAuthority(role),
      createdAt: role.created_at,
      lastActive: role.occupant_last_active ?? null,
      avatarUrl: role.occupant_avatar_url,
    });
  }

  const rows = [...byHumanId.values()];

  if (user?.id && hasCompanyAccess(user, companyId) && !byHumanId.has(user.id)) {
    rows.push({
      id: `human:${user.id}:self`,
      name: user.name || user.email || "You",
      detail: user.email || user.id,
      status: "no_role",
      roleIds: [],
      roles: [],
      authorityRole: null,
      createdAt: null,
      lastActive: null,
      avatarUrl: user.avatar_url,
    });
  }

  for (const invitation of invitations) {
    if (invitation.declined_at || isExpired(invitation.expires_at)) continue;

    const roleTitle = roleTitleById.get(invitation.role_id) ?? "Role";
    const invitedAuthority = roleAuthority(roles.find((role) => role.id === invitation.role_id));
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
        authorityRole: invitedAuthority,
        createdAt: invitation.redeemed_at,
        lastActive: null,
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
      authorityRole: invitedAuthority,
      createdAt: invitation.created_at,
      lastActive: null,
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

export function canManageInvitations(grants: string[]): boolean {
  return grants.includes("*") || grants.includes("roles.manage");
}

export function roleList(roles: string[]): string {
  return roles.length > 0 ? roles.join(", ") : "";
}

export function authorityRoleLabel(role: MemberAuthorityRole | null): string {
  if (role === "director") return "Director";
  if (role === "operator") return "Operator";
  if (role === "advisor") return "Advisor";
  return "-";
}

function roleAuthority(role: Role | undefined): MemberAuthorityRole | null {
  if (!role) return null;
  if (role.role_type === "director" || role.role_type === "owner") return "director";
  if (role.role_type === "advisor") return "advisor";
  return "operator";
}

function strongestAuthorityRole(
  current: MemberAuthorityRole | null,
  next: MemberAuthorityRole | null,
): MemberAuthorityRole | null {
  return authorityRank(next) < authorityRank(current) ? next : current;
}

function authorityRank(role: MemberAuthorityRole | null): number {
  if (role === "director") return 0;
  if (role === "operator") return 1;
  if (role === "advisor") return 2;
  return 3;
}

function timestamp(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestTimestamp(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta)) return b;
  if (!Number.isFinite(tb)) return a;
  return tb > ta ? b : a;
}

function hasCompanyAccess(
  user: { roots?: string[]; entities?: string[] },
  companyId: string,
): boolean {
  return (
    !!companyId && (user.roots?.includes(companyId) || user.entities?.includes(companyId) || false)
  );
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
