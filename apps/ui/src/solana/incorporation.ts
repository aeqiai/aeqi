/**
 * On-chain reads for the Incorporation surface.
 *
 * The Incorporation tab displays the TRUST's constitutional state — the
 * Trust account (identity, authority, paused flag, module count) plus
 * the per-module records that hang off it. Both reads go DIRECT from
 * the browser through the shared Anchor provider; writes go through
 * aeqi-platform.
 *
 * Source-of-truth references:
 *   - Trust struct: `programs/aeqi-trust/src/lib.rs` (mirror at
 *     `apps/ui/src/solana/generated/types/aeqi_trust.ts`, type `trust`,
 *     PDA seeded `[b"trust", trust_id]`).
 *   - Module struct: same crate, type `module`, PDA seeded
 *     `[b"module", trust, module_id]`. First field is `trust: pubkey`,
 *     so an Anchor `account.module.all()` call with a memcmp filter at
 *     offset 8 (past the discriminator) scopes the list to one TRUST.
 */
import { PublicKey } from "@solana/web3.js";
import type { IdlAccounts } from "@coral-xyz/anchor";

import { getRoleProgram, getTrustProgram } from "./programs";
import type { AeqiRole } from "./generated/types/aeqi_role";
import type { AeqiTrust } from "./generated/types/aeqi_trust";

/** Typed alias for the Trust account as returned by Anchor's fetch. */
export type TrustAccount = IdlAccounts<AeqiTrust>["trust"];

/** Typed alias for the Module account as returned by Anchor's fetch. */
export type ModuleAccount = IdlAccounts<AeqiTrust>["module"];

/** Typed alias for the Role account as returned by Anchor's fetch. */
export type RoleAccount = IdlAccounts<AeqiRole>["role"];

/** Module account paired with its on-chain address (the PDA). */
export interface ModuleAccountWithPda {
  publicKey: PublicKey;
  account: ModuleAccount;
}

/** Role account paired with its on-chain address (the PDA). */
export interface RoleAccountWithPda {
  publicKey: PublicKey;
  account: RoleAccount;
}

/**
 * Fetch the Trust account at the given PDA address.
 *
 * `trustPda` is the base58-encoded Trust PDA — same value as
 * `entity.trust_address` on the platform-side Trust record. Returns
 * `null` if the account doesn't exist on the cluster (e.g. the TRUST
 * has not been bridged on-chain yet).
 */
export async function readTrust(trustPda: string | PublicKey): Promise<TrustAccount | null> {
  const program = getTrustProgram();
  const pda = typeof trustPda === "string" ? new PublicKey(trustPda) : trustPda;
  return program.account.trust.fetchNullable(pda) as Promise<TrustAccount | null>;
}

/**
 * List every Module account belonging to a Trust.
 *
 * Anchor's `account.module.all([filter])` walks `getProgramAccounts` with
 * the supplied memcmp filter. The Module struct lays out as
 * `[discriminator(8)][trust(32)][...]`, so filtering at offset 8 with
 * `bytes = trustPda.toBase58()` scopes the result to one TRUST.
 */
export async function readModules(trustPda: string | PublicKey): Promise<ModuleAccountWithPda[]> {
  const program = getTrustProgram();
  const pda = typeof trustPda === "string" ? new PublicKey(trustPda) : trustPda;
  const results = await program.account.module.all([
    {
      memcmp: {
        offset: 8,
        bytes: pda.toBase58(),
      },
    },
  ]);
  return results.map((r) => ({
    publicKey: r.publicKey,
    account: r.account as ModuleAccount,
  }));
}

/**
 * List every Role account belonging to a Trust.
 *
 * The Role struct (in `aeqi_role`) lays out as
 * `[discriminator(8)][trust(32)][role_id(32)][role_type_id(32)]...`, so
 * filtering at offset 8 with `bytes = trustPda.toBase58()` scopes the
 * scan to a single TRUST. Mirrors the `readModules` pattern in this
 * file — Role is the org-chart sibling of Module on the role program.
 *
 * Foundation-shaped TRUSTs that haven't adopted `aeqi_role` simply
 * return `[]` (no accounts match) — this is not an error condition.
 */
export async function readRoles(trustPda: string | PublicKey): Promise<RoleAccountWithPda[]> {
  const program = getRoleProgram();
  const pda = typeof trustPda === "string" ? new PublicKey(trustPda) : trustPda;
  const results = await program.account.role.all([
    {
      memcmp: {
        offset: 8,
        bytes: pda.toBase58(),
      },
    },
  ]);
  return results.map((r) => ({
    publicKey: r.publicKey,
    account: r.account as RoleAccount,
  }));
}
