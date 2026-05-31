/**
 * On-chain reads for the Quorum surface.
 *
 * The Quorum tab displays governance state for a COMPANY — the registered
 * voting configs (token-mode and/or per-role-mode) plus every proposal
 * that has ever been created against this COMPANY. Both reads scan
 * `aeqi_governance` PDAs with a memcmp filter at offset 8 (past the
 * Anchor 8-byte discriminator), where the first struct field on both
 * `GovernanceConfig` and `Proposal` is `company: pubkey`.
 *
 * Status is derived client-side from the Proposal account's tallies +
 * lifecycle flags + the cluster clock. The chain itself does not store
 * a status enum — `executed` and `canceled` are explicit booleans and
 * everything else is implied by the (for/against/abstain, vote_start,
 * vote_duration, succeeded_at) tuple.
 *
 * For role-mode proposals (`governance_config_id != [0; 32]`) the
 * config_id IS the `role_type_id` of the role type allowed to vote.
 * We expose the raw id; the UI layer resolves it to a friendly label
 * by fetching `aeqi_role.RoleType` accounts off the same COMPANY.
 *
 * Source-of-truth references:
 *   - GovernanceConfig: `programs/aeqi-governance/src/lib.rs` (mirror at
 *     `apps/ui/src/solana/generated/types/aeqi_governance.ts`, type
 *     `governanceConfig`, PDA seeded `[b"gov_config", company, governance_config_id]`).
 *   - Proposal: same crate, type `proposal`, PDA seeded
 *     `[b"proposal", company, proposal_id]`. First field is `company`,
 *     so memcmp at offset 8 scopes the list to one COMPANY.
 *   - RoleType: `programs/aeqi-role/src/lib.rs`, type `roleType`, also
 *     `company`-first so the same offset 8 trick applies.
 */
import { PublicKey } from "@solana/web3.js";
import type { IdlAccounts } from "@coral-xyz/anchor";
import bs58 from "bs58";

import { getConnection } from "./client";
import { AEQI_GOVERNANCE_PROGRAM_ID } from "./pdas";
import { getGovernanceProgram, getRoleProgram } from "./programs";
import type { AeqiGovernance } from "./generated/types/aeqi_governance";
import type { AeqiRole } from "./generated/types/aeqi_role";

/** Typed alias for the GovernanceConfig account as returned by Anchor's fetch. */
export type GovernanceConfigAccount = IdlAccounts<AeqiGovernance>["governanceConfig"];

/** Typed alias for the Proposal account as returned by Anchor's fetch. */
export type ProposalAccount = IdlAccounts<AeqiGovernance>["proposal"];

/** Typed alias for the RoleType account as returned by Anchor's fetch. */
export type RoleTypeAccount = IdlAccounts<AeqiRole>["roleType"];

/** Typed alias for the VoteRecord account as returned by Anchor's fetch. */
export type VoteRecordAccount = IdlAccounts<AeqiGovernance>["voteRecord"];

/**
 * Canonical mapping of the on-chain `VoteChoice` discriminant.
 *
 * The chain stores `choice` as a `u8`; the program enforces these three
 * values via the `VoteChoice` enum. We keep the labels here so the UI
 * doesn't have to spread `if (choice === 1)` across cells.
 */
export const VOTE_CHOICE_LABEL: Record<number, "For" | "Against" | "Abstain"> = {
  1: "For",
  0: "Against",
  2: "Abstain",
};

/** GovernanceConfig paired with its on-chain address (the PDA). */
export interface GovernanceConfigWithPda {
  publicKey: PublicKey;
  account: GovernanceConfigAccount;
}

/** Proposal paired with its on-chain address (the PDA). */
export interface ProposalWithPda {
  publicKey: PublicKey;
  account: ProposalAccount;
}

/** RoleType paired with its on-chain address (the PDA). */
export interface RoleTypeWithPda {
  publicKey: PublicKey;
  account: RoleTypeAccount;
}

/** VoteRecord paired with its on-chain address (the PDA). */
export interface VoteRecordWithPda {
  publicKey: PublicKey;
  account: VoteRecordAccount;
}

/**
 * Derived proposal lifecycle status.
 *
 * The chain does not store this — it's a function of (executed,
 * canceled, vote_start, vote_duration, for_votes, against_votes,
 * succeeded_at) evaluated against the current cluster clock. Computed
 * client-side so the surface always reflects "right now".
 */
export type ProposalStatus =
  | "active" // vote window open
  | "succeeded" // vote ended, for > against, quorum hit (approx)
  | "defeated" // vote ended, for <= against
  | "executed" // executed flag set
  | "canceled" // canceled flag set
  | "pending"; // vote_start in the future

/**
 * Voting mode discriminated by `governance_config_id`.
 *
 * `[0; 32]` is the canonical sentinel for the token-weighted config;
 * any other value points at a `RoleType.role_type_id` for per-role
 * multisig voting.
 */
export type VotingMode = { kind: "token" } | { kind: "role"; roleTypeId: Uint8Array };

/**
 * Detect the canonical "token-mode" sentinel: a 32-byte id of all zeros.
 *
 * Anchor decodes `[u8; 32]` as either a `Uint8Array` or a plain
 * number[]; normalize before the compare.
 */
export function isTokenModeId(bytes: Uint8Array | number[]): boolean {
  const arr = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  if (arr.length !== 32) return false;
  for (let i = 0; i < 32; i++) {
    if (arr[i] !== 0) return false;
  }
  return true;
}

/** Compare two 32-byte ids for equality, tolerating both decode shapes. */
function bytes32Equal(a: Uint8Array | number[], b: Uint8Array | number[]): boolean {
  const aa = a instanceof Uint8Array ? a : Uint8Array.from(a);
  const bb = b instanceof Uint8Array ? b : Uint8Array.from(b);
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i++) {
    if (aa[i] !== bb[i]) return false;
  }
  return true;
}

/** Resolve the voting mode for a given `governance_config_id`. */
export function votingModeFor(configId: Uint8Array | number[]): VotingMode {
  if (isTokenModeId(configId)) return { kind: "token" };
  const arr = configId instanceof Uint8Array ? configId : Uint8Array.from(configId);
  return { kind: "role", roleTypeId: arr };
}

/**
 * Look up the RoleType account whose `role_type_id` matches `id`.
 *
 * Returns `undefined` if the caller's role types don't include one
 * matching this id — happens when the governance config_id was
 * registered against a role type that has since been removed, or when
 * the indexer has yet to surface the role type list to the UI.
 */
export function findRoleTypeById(
  roleTypes: RoleTypeWithPda[] | undefined,
  id: Uint8Array,
): RoleTypeWithPda | undefined {
  if (!roleTypes) return undefined;
  for (const rt of roleTypes) {
    if (bytes32Equal(rt.account.roleTypeId, id)) return rt;
  }
  return undefined;
}

/** Snapshot-root status — only meaningful for token-mode proposals. */
export function isSnapshotPending(snapshotRoot: Uint8Array | number[]): boolean {
  return isTokenModeId(snapshotRoot);
}

/**
 * Derive the proposal's lifecycle status against a wall clock.
 *
 * `nowSeconds` is the unix-second timestamp to evaluate against —
 * callers should pass `Math.floor(Date.now() / 1000)` for "right now".
 * Quorum is approximated by ignoring it here (the chain enforces it at
 * `execute_proposal` time, not at status-derivation time); a future
 * pass can fetch the GovernanceConfig to enforce `quorum_bps` exactly,
 * but for v1 the executed/canceled flags plus the tally suffice to
 * label the row.
 */
export function deriveProposalStatus(account: ProposalAccount, nowSeconds: number): ProposalStatus {
  if (account.executed) return "executed";
  if (account.canceled) return "canceled";

  // Anchor decodes i64 as BN; voteStart / voteDuration are BN-typed.
  const voteStart = Number(account.voteStart.toString());
  const voteDuration = Number(account.voteDuration.toString());
  const voteEnd = voteStart + voteDuration;

  if (nowSeconds < voteStart) return "pending";
  if (nowSeconds <= voteEnd) return "active";

  // Vote window has closed. Decide succeeded vs defeated from tallies.
  // BN comparisons are stringly-typed via .gt/.lt, but for the
  // "for > against" case the simpler BigInt route is enough.
  const forVotes = BigInt(account.forVotes.toString());
  const againstVotes = BigInt(account.againstVotes.toString());
  return forVotes > againstVotes ? "succeeded" : "defeated";
}

/**
 * Probe whether the `aeqi_governance` program is deployed on the active
 * cluster. The browser already has the program ID baked in (it's the
 * Anchor-declared address in the IDL); a single `getAccountInfo` against
 * it tells us whether the cluster has a program account at that address.
 *
 * Returns `true` when the program is deployed (account exists AND is
 * executable), `false` when the cluster is reachable but the program
 * has not been deployed. Throws on RPC failure so the caller can show
 * the standard "couldn't read on-chain state" error rather than a
 * misleading "program not provisioned" empty state.
 *
 * Used by the Quorum surface to distinguish:
 *   - "program not yet provisioned on this cluster" (operator needs to
 *     deploy the governance program) from
 *   - "program deployed, this COMPANY has no configs yet" (operator needs
 *     to register a voting config).
 *
 * Both empty states existed conceptually before this read; only the
 * latter rendered as a useful CTA.
 */
export async function isGovernanceProgramDeployed(): Promise<boolean> {
  const conn = getConnection();
  const info = await conn.getAccountInfo(AEQI_GOVERNANCE_PROGRAM_ID, "confirmed");
  // A deployed BPF program account is owned by the BPF loader and has
  // `executable: true`. A non-existent account returns null.
  return info !== null && info.executable === true;
}

/**
 * List every GovernanceConfig account registered against a Company.
 *
 * Anchor's `account.governanceConfig.all([filter])` walks
 * `getProgramAccounts` on `aeqi_governance` with the supplied memcmp
 * filter. The GovernanceConfig struct lays out as
 * `[discriminator(8)][company(32)][...]`, so filtering at offset 8 with
 * the COMPANY PDA as the byte pattern scopes the result to one COMPANY.
 */
export async function readGovernanceConfigs(
  trustPda: string | PublicKey,
): Promise<GovernanceConfigWithPda[]> {
  const program = getGovernanceProgram();
  const pda = typeof trustPda === "string" ? new PublicKey(trustPda) : trustPda;
  const results = await program.account.governanceConfig.all([
    {
      memcmp: {
        offset: 8,
        bytes: pda.toBase58(),
      },
    },
  ]);
  return results.map((r) => ({
    publicKey: r.publicKey,
    account: r.account as GovernanceConfigAccount,
  }));
}

/**
 * List every Proposal account belonging to a Company.
 *
 * Same memcmp pattern as the configs: Proposal lays out as
 * `[discriminator(8)][company(32)][...]`, so offset 8 scopes the scan.
 */
export async function readProposals(trustPda: string | PublicKey): Promise<ProposalWithPda[]> {
  const program = getGovernanceProgram();
  const pda = typeof trustPda === "string" ? new PublicKey(trustPda) : trustPda;
  const results = await program.account.proposal.all([
    {
      memcmp: {
        offset: 8,
        bytes: pda.toBase58(),
      },
    },
  ]);
  return results.map((r) => ({
    publicKey: r.publicKey,
    account: r.account as ProposalAccount,
  }));
}

/**
 * List every RoleType account belonging to a Company.
 *
 * Needed to resolve a proposal's `governance_config_id` (when it's
 * NOT the token-mode sentinel) into a human-readable role label. Same
 * company-first layout, so the same offset-8 memcmp applies.
 */
export async function readRoleTypes(trustPda: string | PublicKey): Promise<RoleTypeWithPda[]> {
  const program = getRoleProgram();
  const pda = typeof trustPda === "string" ? new PublicKey(trustPda) : trustPda;
  const results = await program.account.roleType.all([
    {
      memcmp: {
        offset: 8,
        bytes: pda.toBase58(),
      },
    },
  ]);
  return results.map((r) => ({
    publicKey: r.publicKey,
    account: r.account as RoleTypeAccount,
  }));
}

/**
 * List every VoteRecord cast against a specific proposal.
 *
 * `VoteRecord` lays out as `[discriminator(8)][company(32)][proposalId(32)]
 * [voter(32)][choice(1)][weight(16)][bump(1)]`. We compose two memcmp
 * filters: company at offset 8 (base58 PublicKey), proposalId at offset 40
 * (base58-encoded raw 32 bytes). Anchor's `account.voteRecord.all` is the
 * same `getProgramAccounts` machinery used everywhere else on the page,
 * so RPC cost matches the other reads.
 *
 * The result is the full audit trail "who voted what, when" for a single
 * proposal — needed by the detail-modal vote-history table. Empty array
 * when no votes have been cast yet (chain returns 0 rows; not an error).
 */
export async function readVoteRecords(
  trustPda: string | PublicKey,
  proposalId: Uint8Array | number[],
): Promise<VoteRecordWithPda[]> {
  const program = getGovernanceProgram();
  const pda = typeof trustPda === "string" ? new PublicKey(trustPda) : trustPda;
  const proposalIdBytes =
    proposalId instanceof Uint8Array ? proposalId : Uint8Array.from(proposalId);
  const proposalIdB58 = bs58.encode(proposalIdBytes);
  const results = await program.account.voteRecord.all([
    {
      memcmp: {
        offset: 8,
        bytes: pda.toBase58(),
      },
    },
    {
      memcmp: {
        offset: 40,
        bytes: proposalIdB58,
      },
    },
  ]);
  return results.map((r) => ({
    publicKey: r.publicKey,
    account: r.account as VoteRecordAccount,
  }));
}

/**
 * List every VoteRecord ever cast against this COMPANY — no proposalId
 * filter. Used by the KPI strip's "voter turnout" tile to compute unique
 * voters across recent proposals without N round-trips. Same memcmp on
 * offset 8 as the proposal/config readers; one `getProgramAccounts` call.
 *
 * On a COMPANY with thousands of historical votes this is heavier than the
 * single-proposal reader, but the KPI strip is small and cached at the
 * same 30s staleness as the proposal list, so the page-load cost stays
 * bounded. For larger Companies the platform indexer eventually owns this
 * aggregate; until then the direct RPC read keeps the surface honest.
 */
export async function readAllVoteRecords(
  trustPda: string | PublicKey,
): Promise<VoteRecordWithPda[]> {
  const program = getGovernanceProgram();
  const pda = typeof trustPda === "string" ? new PublicKey(trustPda) : trustPda;
  const results = await program.account.voteRecord.all([
    {
      memcmp: {
        offset: 8,
        bytes: pda.toBase58(),
      },
    },
  ]);
  return results.map((r) => ({
    publicKey: r.publicKey,
    account: r.account as VoteRecordAccount,
  }));
}
