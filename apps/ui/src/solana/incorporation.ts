/**
 * On-chain reads for the Incorporation surface.
 *
 * The Incorporation tab displays the COMPANY's constitutional state — the
 * Company account (identity, authority, paused flag, module count) plus
 * the per-module records that hang off it. Both reads go DIRECT from
 * the browser through the shared Anchor provider; writes go through
 * aeqi-platform.
 *
 * Source-of-truth references:
 *   - Company struct: `programs/aeqi-company/src/lib.rs` (mirror at
 *     `apps/ui/src/solana/generated/types/aeqi_company.ts`, type `company`,
 *     PDA seeded `[b"company", company_id]`).
 *   - Module struct: same crate, type `module`, PDA seeded
 *     `[b"module", company, module_id]`. First field is `company: pubkey`,
 *     so an Anchor `account.module.all()` call with a memcmp filter at
 *     offset 8 (past the discriminator) scopes the list to one COMPANY.
 */
import { PublicKey } from "@solana/web3.js";
import type { IdlAccounts } from "@coral-xyz/anchor";

import { getRoleProgram, getCompanyProgram } from "./programs";
import type { AeqiRole } from "./generated/types/aeqi_role";
import type { AeqiCompany } from "./generated/types/aeqi_company";

/** Typed alias for the Company account as returned by Anchor's fetch. */
export type CompanyAccount = IdlAccounts<AeqiCompany>["company"];

/** Typed alias for the Module account as returned by Anchor's fetch. */
export type ModuleAccount = IdlAccounts<AeqiCompany>["module"];

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
 * Fetch the Company account at the given PDA address.
 *
 * `trustPda` is the base58-encoded Company PDA — same value as
 * `entity.company_address` on the platform-side Company record. Returns
 * `null` if the account doesn't exist on the cluster (e.g. the COMPANY
 * has not been bridged on-chain yet).
 */
export async function readCompany(trustPda: string | PublicKey): Promise<CompanyAccount | null> {
  const program = getCompanyProgram();
  const pda = typeof trustPda === "string" ? new PublicKey(trustPda) : trustPda;
  return program.account.company.fetchNullable(pda) as Promise<CompanyAccount | null>;
}

/**
 * List every Module account belonging to a Company.
 *
 * Anchor's `account.module.all([filter])` walks `getProgramAccounts` with
 * the supplied memcmp filter. The Module struct lays out as
 * `[discriminator(8)][company(32)][...]`, so filtering at offset 8 with
 * `bytes = trustPda.toBase58()` scopes the result to one COMPANY.
 */
export async function readModules(trustPda: string | PublicKey): Promise<ModuleAccountWithPda[]> {
  const program = getCompanyProgram();
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
 * List every Role account belonging to a Company.
 *
 * The Role struct (in `aeqi_role`) lays out as
 * `[discriminator(8)][company(32)][role_id(32)][role_type_id(32)]...`, so
 * filtering at offset 8 with `bytes = trustPda.toBase58()` scopes the
 * scan to a single COMPANY. Mirrors the `readModules` pattern in this
 * file — Role is the org-chart sibling of Module on the role program.
 *
 * Foundation-shaped Companies that haven't adopted `aeqi_role` simply
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
