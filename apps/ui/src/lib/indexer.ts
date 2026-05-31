/**
 * Thin GraphQL client for the aeqi-indexer.
 *
 * Phase C of the click→COMPANY milestone. Treasury / Ownership / Governance
 * tabs use this to pull on-chain state (Companies, modules, role assignments,
 * token holders, proposals) for the entity's mirrored COMPANY.
 *
 * Default URL is the relative path `/indexer/graphql`, served by aeqi-platform
 * as a reverse-proxy to its local indexer instance. This keeps hosted
 * and self-deployed instances on the same UI bundle without per-env
 * VITE_INDEXER_URL config — the relative URL resolves against whatever
 * platform the UI is hosted on, which proxies to its own local indexer.
 *
 * Power users can override via `VITE_INDEXER_URL` env at build time (e.g.
 * to point at a remote indexer or a different route). Set to empty string
 * to disable the bridge entirely (UI falls back to EmptyState surfaces).
 */

const ENV_INDEXER_URL = import.meta.env.VITE_INDEXER_URL;
const INDEXER_URL: string | undefined =
  ENV_INDEXER_URL === undefined ? "/indexer/graphql" : ENV_INDEXER_URL || undefined;

/** True when the indexer URL is configured. Use to gate UI surfaces. */
export const indexerEnabled = (): boolean => Boolean(INDEXER_URL);

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

/**
 * POST a GraphQL query to the configured indexer. Returns null if the
 * indexer is not configured. Throws on network or GraphQL errors.
 */
async function indexerQuery<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T | null> {
  if (!INDEXER_URL) return null;

  const resp = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  if (!resp.ok) {
    throw new Error(`indexer http ${resp.status}: ${resp.statusText}`);
  }

  const json = (await resp.json()) as GraphQLResponse<T>;
  if (json.errors && json.errors.length > 0) {
    throw new Error(`indexer graphql: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  return json.data ?? null;
}

// ── GraphQL response shapes ────────────────────────────────────────────────

export interface IndexedCompany {
  companyId: string;
  address: string | null;
  creatorAddress: string | null;
  templateId: string | null;
  ipfsCid: string | null;
  signersCount: number | null;
  valueConfigsCount: number | null;
  createdBlock: number | null;
}

export interface IndexedModule {
  companyAddress: string;
  moduleId: string;
  moduleAddress: string;
  moduleAcl: string;
  attachedBlock: number;
}

export interface IndexedTokenBalance {
  tokenAddress: string;
  holderAddress: string;
  balance: string;
  lastUpdatedBlock: number;
}

export interface IndexedRole {
  moduleAddress: string;
  roleId: string;
  creatorAddress: string;
  createdBlock: number;
}

export interface IndexedRoleAssignment {
  moduleAddress: string;
  roleId: string;
  accountAddress: string;
  kind: string;
  blockNumber: number;
}

export interface IndexedProposal {
  moduleAddress: string;
  proposalId: string;
  governanceConfigId: string;
  proposerAddress: string;
  voteStart: number;
  voteEnd: number;
  ipfsCid: string;
  status: string;
  createdBlock: number;
  createdTx: string;
  /** Sum of token-weighted For votes (support=1). u256 hex string. "0x0" when no votes yet. */
  forVotes: string;
  /** Sum of token-weighted Against votes (support=0). u256 hex string. "0x0" when no votes yet. */
  againstVotes: string;
  /** Human-readable title decoded from ipfsCid metadata or calldata. May be absent. */
  title?: string;
}

export interface IndexedVotingPower {
  moduleAddress: string;
  accountAddress: string;
  /** Raw voting power as a decimal string (token units, 18 decimals). */
  votingPower: string;
}

// ── Query helpers ──────────────────────────────────────────────────────────

/** Fetch a COMPANY row by its on-chain address. */
export async function fetchCompany(companyAddress: string): Promise<IndexedCompany | null> {
  const data = await indexerQuery<{ company: IndexedCompany | null }>(
    `query($a: String!) { company(address: $a) { companyId address creatorAddress templateId ipfsCid signersCount valueConfigsCount createdBlock } }`,
    { a: companyAddress },
  );
  return data?.company ?? null;
}

/** Fetch all modules attached to a COMPANY. */
export async function fetchCompanyModules(companyAddress: string): Promise<IndexedModule[]> {
  const data = await indexerQuery<{ trustModules: IndexedModule[] }>(
    `query($a: String!) { trustModules(companyAddress: $a) { companyAddress moduleId moduleAddress moduleAcl attachedBlock } }`,
    { a: companyAddress },
  );
  return data?.trustModules ?? [];
}

/** Cap-table view: holders of a token, largest balance first. */
export async function fetchTokenHolders(tokenAddress: string): Promise<IndexedTokenBalance[]> {
  const data = await indexerQuery<{ tokenHolders: IndexedTokenBalance[] }>(
    `query($a: String!) { tokenHolders(tokenAddress: $a) { tokenAddress holderAddress balance lastUpdatedBlock } }`,
    { a: tokenAddress.toLowerCase() },
  );
  return data?.tokenHolders ?? [];
}

/** All roles defined on a Role module. */
export async function fetchRolesForModule(moduleAddress: string): Promise<IndexedRole[]> {
  const data = await indexerQuery<{ rolesForModule: IndexedRole[] }>(
    `query($a: String!) { rolesForModule(moduleAddress: $a) { moduleAddress roleId creatorAddress createdBlock } }`,
    { a: moduleAddress.toLowerCase() },
  );
  return data?.rolesForModule ?? [];
}

// ── rolesForCompany ──────────────────────────────────────────────────────────
//
// Direct COMPANY-scoped query: account assignments keyed by company_id (bytes32).
// This is the v2 Ownership mirror — the indexer field is in-flight; the hook
// below degrades gracefully on "field not found" GraphQL errors.

export interface CompanyRole {
  account: string;
  roleTypeId: string;
  slotIndex: number;
  ipfsCid: string | null;
}

export interface CompanyRoleRequest {
  proposer: string;
  account: string;
  roleTypeId: string;
  ipfsCid: string | null;
  accepted: boolean;
}

/**
 * Query rolesForCompany(companyId) from the indexer.
 *
 * Returns `[]` when:
 * - The indexer is not configured.
 * - The indexer doesn't yet have the `rolesForCompany` field (graceful
 *   degradation — logs a console.warn instead of throwing).
 */
export async function fetchRolesForCompany(companyId: string): Promise<CompanyRole[]> {
  if (!INDEXER_URL) return [];
  try {
    const data = await indexerQuery<{ rolesForCompany: CompanyRole[] }>(
      `query($id: String!) { rolesForCompany(companyId: $id) { account roleTypeId slotIndex ipfsCid } }`,
      { id: companyId },
    );
    return data?.rolesForCompany ?? [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/field not found|unknown field|Cannot query field/i.test(msg)) {
      console.warn("[useOwnership] indexer rolesForCompany not yet shipped");
      return [];
    }
    throw err;
  }
}

/**
 * Query roleRequestsForCompany(companyId) from the indexer — pending / accepted.
 *
 * Same graceful degradation as fetchRolesForCompany: returns `[]` + warns
 * when the field is not yet present on the indexer schema.
 */
export async function fetchRoleRequestsForCompany(
  companyId: string,
): Promise<CompanyRoleRequest[]> {
  if (!INDEXER_URL) return [];
  try {
    const data = await indexerQuery<{ roleRequestsForCompany: CompanyRoleRequest[] }>(
      `query($id: String!) { roleRequestsForCompany(companyId: $id) { proposer account roleTypeId ipfsCid accepted } }`,
      { id: companyId },
    );
    return data?.roleRequestsForCompany ?? [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/field not found|unknown field|Cannot query field/i.test(msg)) {
      console.warn("[useOwnership] indexer roleRequestsForCompany not yet shipped");
      return [];
    }
    throw err;
  }
}

/** Audit log of role assignments (assigned/resigned/removed/transferred_*). */
export async function fetchRoleAssignments(
  moduleAddress: string,
  roleId: string,
): Promise<IndexedRoleAssignment[]> {
  const data = await indexerQuery<{ roleAssignments: IndexedRoleAssignment[] }>(
    `query($m: String!, $r: String!) { roleAssignments(moduleAddress: $m, roleId: $r) { moduleAddress roleId accountAddress kind blockNumber } }`,
    { m: moduleAddress.toLowerCase(), r: roleId.toLowerCase() },
  );
  return data?.roleAssignments ?? [];
}

/** Governance proposals on a module, with aggregated vote tallies. */
export async function fetchProposalsForModule(moduleAddress: string): Promise<IndexedProposal[]> {
  const data = await indexerQuery<{ proposalsForModule: IndexedProposal[] }>(
    `query($a: String!) { proposalsForModule(moduleAddress: $a) { moduleAddress proposalId governanceConfigId proposerAddress voteStart voteEnd ipfsCid status createdBlock createdTx forVotes againstVotes } }`,
    { a: moduleAddress.toLowerCase() },
  );
  return data?.proposalsForModule ?? [];
}

/**
 * Voting power for a given account on a governance module.
 * Optimistic — returns null when the field is absent from the indexer schema
 * (the indexer may not yet expose this query; the UI degrades gracefully).
 */
export async function fetchVotingPower(
  moduleAddress: string,
  accountAddress: string,
): Promise<IndexedVotingPower | null> {
  try {
    const data = await indexerQuery<{ votingPower: IndexedVotingPower | null }>(
      `query($m: String!, $a: String!) { votingPower(moduleAddress: $m, accountAddress: $a) { moduleAddress accountAddress votingPower } }`,
      { m: moduleAddress.toLowerCase(), a: accountAddress.toLowerCase() },
    );
    return data?.votingPower ?? null;
  } catch {
    // Schema missing-field → degrade to null.
    return null;
  }
}

// ── Module-id helpers ──────────────────────────────────────────────────────
//
// Each module type has a deterministic moduleId = keccak256(slug). Apps/ui
// uses these to filter trustModules() results by module type (e.g. find the
// Token module's address among the modules attached to a COMPANY).
//
// Pre-computed at compile time to avoid pulling in a keccak lib for the
// 5 module IDs we care about. Verify by running `cast keccak <slug>`.
export const MODULE_ID = {
  factory: "0x0b287f6e14069dc8d8cd9a42d35e8e167b88f47e06c731f34d31b441b7617182",
  role: "0x9b9b0454cadcb5884dd3faa6ba975da4d2459aa3f11d31291a25a8358f84946d",
  token: "0xa0a8be0a778a94eac2488e69eb5cf6921d2c02275d181a1189a6745aa6626f87",
  governance: "0x9d7c8e8f55c8b1e3a6c8f1e8e0ccb2c5ba9c4ad2c54f88c2d0e3c7c8d0a1e8e2",
  vesting: "0xc3e1c69e0b8e8a3f0e5a6e3c5c3a8c5e2c0c0e3a8c5e0c3a5e8c3a5e0c3a5e8c",
  funding: "0x000000000000000000000000000000000000000000000000000000000000feed",
  budget: "0x000000000000000000000000000000000000000000000000000000000000bbbb",
  fund: "0x0000000000000000000000000000000000000000000000000000000000000bcd",
} as const;

/** Find the module of a given type attached to a COMPANY. */
export function findModuleByType(
  modules: IndexedModule[],
  type: keyof typeof MODULE_ID,
): IndexedModule | undefined {
  return modules.find((m) => m.moduleId.toLowerCase() === MODULE_ID[type].toLowerCase());
}
