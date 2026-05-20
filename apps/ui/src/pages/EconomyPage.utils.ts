import type { Role, Trust } from "@/lib/types";

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
