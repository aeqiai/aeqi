import type { CapTableEntry, Role, RoleType, Trust } from "@/lib/types";

export type EconomyTab = "overview" | "trusts" | "pools" | "funding" | "roles";

export type PoolKind = "genesis" | "amm";

export const POOL_KIND_LABEL: Record<PoolKind, string> = {
  genesis: "Genesis curve",
  amm: "AMM pool",
};

/** Chip-strip label for the pools kind filter. Shorter than the row label so
 * the chip row stays calm against the table beneath it. */
export const POOL_KIND_CHIP_LABEL: Record<PoolKind, string> = {
  genesis: "Genesis",
  amm: "AMM",
};

export type PoolKindFilter = "all" | PoolKind;

/** Trusts-tab scoped visibility filter. `?public=1` scopes the trust table
 * to published profiles only — the same axis the Public column exposes
 * (c4 TableStatus). Missing/invalid param = "all". */
export type TrustVisibilityFilter = "all" | "public";

export function isTrustVisibilityParam(value: string | null | undefined): value is "public" {
  return value === "1" || value === "public";
}

/** Roles-tab scoped role-type filter. `?role_type=owner|director|operational|advisor`
 * narrows the open-roles table to one tier — founder/director vs operational
 * openings read very differently. Mirrors the `?kind=` pattern: a multi-value
 * enum chip strip with "All" as the unfiltered default. Missing/invalid
 * param = "all". */
export type RoleTypeFilter = "all" | RoleType;

const ROLE_TYPES: readonly RoleType[] = ["owner", "director", "operational", "advisor"];

export function isRoleType(value: string | null | undefined): value is RoleType {
  return !!value && (ROLE_TYPES as readonly string[]).includes(value);
}

/** Title-case chip label for the role-type filter. The wire value stays
 * lowercase (URL identifier); the display layer renders Title Case per the
 * design-system lockword ("Lowercase is brand, not labels"). */
export const ROLE_TYPE_CHIP_LABEL: Record<RoleType, string> = {
  owner: "Owner",
  director: "Director",
  operational: "Operator",
  advisor: "Advisor",
};

export interface EconomyPoolSearchRow {
  trust: Trust;
  curve: string;
  assetMint: string;
  quoteMint: string;
  buyAmount: number;
  maxCost: number;
}

export interface EconomyRoleSearchRow {
  trust: Trust;
  role: Pick<Role, "id" | "title" | "role_type">;
}

export interface EconomyCapTableSearchRow {
  trust: Trust;
  entry: Pick<
    CapTableEntry,
    | "allocation_key"
    | "holder_kind"
    | "holder_id"
    | "security_type"
    | "basis_points"
    | "vesting_months"
    | "cliff_months"
  >;
}

export const ECONOMY_TABS: Array<{ id: EconomyTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "trusts", label: "Trusts" },
  { id: "pools", label: "Liquidity Pools" },
  { id: "funding", label: "Funding Rounds" },
  { id: "roles", label: "Roles" },
];

export function isEconomyTab(tab: string | undefined): tab is EconomyTab {
  return !!tab && ECONOMY_TABS.some((item) => item.id === tab);
}

const POOL_KINDS: readonly PoolKind[] = ["genesis", "amm"];

export function isPoolKind(value: string | null | undefined): value is PoolKind {
  return !!value && (POOL_KINDS as readonly string[]).includes(value);
}

export function compactAddress(value: string | null | undefined): string {
  if (!value) return "Not on-chain";
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}...${value.slice(-6)}`;
}

function includesQuery(values: Array<string | number | null | undefined>, query: string): boolean {
  if (!query) return true;
  return values
    .filter((value) => value !== null && value !== undefined)
    .join(" ")
    .toLowerCase()
    .includes(query);
}

export function matchesTrustQuery(entity: Trust, query: string): boolean {
  if (!query) return true;
  return includesQuery(
    [
      entity.name,
      entity.tagline,
      entity.id,
      entity.trust_id,
      entity.trust_address,
      entity.creator_address,
      entity.plan,
      entity.placement_status,
    ],
    query,
  );
}

export function matchesPoolQuery(row: EconomyPoolSearchRow, query: string): boolean {
  if (!query) return true;
  return includesQuery(
    [
      row.trust.name,
      row.trust.tagline,
      row.trust.id,
      row.trust.trust_id,
      row.trust.trust_address,
      row.curve,
      row.assetMint,
      row.quoteMint,
      row.buyAmount,
      row.maxCost,
    ],
    query,
  );
}

export function matchesCapTableQuery(row: EconomyCapTableSearchRow, query: string): boolean {
  if (!query) return true;
  return includesQuery(
    [
      row.trust.name,
      row.trust.tagline,
      row.trust.id,
      row.trust.trust_id,
      row.trust.trust_address,
      row.entry.allocation_key,
      row.entry.holder_kind,
      row.entry.holder_id,
      row.entry.security_type,
      row.entry.basis_points,
      row.entry.vesting_months,
      row.entry.cliff_months,
    ],
    query,
  );
}

export function matchesRoleQuery(row: EconomyRoleSearchRow, query: string): boolean {
  if (!query) return true;
  return includesQuery(
    [
      row.role.title,
      row.role.role_type,
      row.role.id,
      row.trust.name,
      row.trust.tagline,
      row.trust.id,
      row.trust.trust_id,
      row.trust.trust_address,
    ],
    query,
  );
}
