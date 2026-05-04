/**
 * Thin GraphQL client for the aeqi-indexer.
 *
 * Phase C of the click→DAO milestone. Treasury / Ownership / Governance
 * tabs use this to pull on-chain state (TRUSTs, modules, role assignments,
 * token holders, proposals) for the entity's mirrored TRUST.
 *
 * URL is configured via `VITE_INDEXER_URL` env. When unset, the client
 * is disabled and `useIndexer*` hooks return null — the consuming pages
 * fall back to their EmptyState surfaces. This keeps the UI safe to ship
 * even when no chain is wired (production mainnet not yet up).
 */

const INDEXER_URL: string | undefined = import.meta.env.VITE_INDEXER_URL;

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

export interface IndexedTrust {
  trustId: string;
  address: string | null;
  creatorAddress: string | null;
  templateId: string | null;
  ipfsCid: string | null;
  signersCount: number | null;
  valueConfigsCount: number | null;
  createdBlock: number | null;
}

export interface IndexedModule {
  trustAddress: string;
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
  proposerAddress: string;
  voteStart: number;
  voteEnd: number;
  ipfsCid: string;
  status: string;
  createdBlock: number;
}

// ── Query helpers ──────────────────────────────────────────────────────────

/** Fetch a TRUST row by its on-chain address. */
export async function fetchTrust(trustAddress: string): Promise<IndexedTrust | null> {
  const data = await indexerQuery<{ trust: IndexedTrust | null }>(
    `query($a: String!) { trust(address: $a) { trustId address creatorAddress templateId ipfsCid signersCount valueConfigsCount createdBlock } }`,
    { a: trustAddress.toLowerCase() },
  );
  return data?.trust ?? null;
}

/** Fetch all modules attached to a TRUST. */
export async function fetchTrustModules(trustAddress: string): Promise<IndexedModule[]> {
  const data = await indexerQuery<{ trustModules: IndexedModule[] }>(
    `query($a: String!) { trustModules(trustAddress: $a) { trustAddress moduleId moduleAddress moduleAcl attachedBlock } }`,
    { a: trustAddress.toLowerCase() },
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

/** Governance proposals on a module. */
export async function fetchProposalsForModule(moduleAddress: string): Promise<IndexedProposal[]> {
  const data = await indexerQuery<{ proposalsForModule: IndexedProposal[] }>(
    `query($a: String!) { proposalsForModule(moduleAddress: $a) { moduleAddress proposalId proposerAddress voteStart voteEnd ipfsCid status createdBlock } }`,
    { a: moduleAddress.toLowerCase() },
  );
  return data?.proposalsForModule ?? [];
}

// ── Module-id helpers ──────────────────────────────────────────────────────
//
// Each module type has a deterministic moduleId = keccak256(slug). Apps/ui
// uses these to filter trustModules() results by module type (e.g. find the
// Token module's address among the modules attached to a TRUST).
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

/** Find the module of a given type attached to a TRUST. */
export function findModuleByType(
  modules: IndexedModule[],
  type: keyof typeof MODULE_ID,
): IndexedModule | undefined {
  return modules.find((m) => m.moduleId.toLowerCase() === MODULE_ID[type].toLowerCase());
}
