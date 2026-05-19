/**
 * TypeScript mirror of the PDA derivation helpers in
 * `aeqi-platform/src/solana_provisioner.rs`. Seeds, program IDs, and
 * sentinel byte layouts MUST stay in lock-step with the Rust side and the
 * on-chain Anchor programs.
 *
 * Source-of-truth references:
 *   - Program IDs: `projects/aeqi-solana/Anchor.toml [programs.localnet]`
 *     and each program's `declare_id!(...)` macro.
 *   - PDA seeds: `aeqi-platform/src/solana_provisioner.rs:204-321` and
 *     each program's `#[account(seeds = [...], bump)]` Anchor attribute.
 *   - Module ID sentinels (`pad32(b"R")` etc.): provisioner constants
 *     `ROLE_MODULE_ID` / `TOKEN_MODULE_ID` / `GOV_MODULE_ID` /
 *     `UNIFUTURES_MODULE_ID`.
 *
 * Seeds are passed as raw `Uint8Array` to avoid a `Buffer` polyfill in
 * the browser bundle (`PublicKey.findProgramAddressSync` accepts both —
 * see @solana/web3.js d.ts).
 */
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

/* ------------------------------------------------------------------ */
/* Program IDs (11 Anchor programs).                                  */
/* Mirrors Anchor.toml [programs.localnet]; same IDs on every cluster */
/* the protocol deploys to (programs are upgradeable).                */
/* ------------------------------------------------------------------ */

export const AEQI_BUDGET_PROGRAM_ID = new PublicKey("5PbDxvaYD9shSGxE2pQyUTqCqe6FXUMDciXSEGevFE5G");
export const AEQI_FACTORY_PROGRAM_ID = new PublicKey(
  "3qRT5qTuv4wkqbLfZQUVcf94QRyG3JdCAbFZsiBNpgEv",
);
export const AEQI_FUND_PROGRAM_ID = new PublicKey("DaFpZcqMaL4rmAemJ2WBeUth42PMmHxNg9t6j9h9p7YP");
export const AEQI_FUNDING_PROGRAM_ID = new PublicKey(
  "8dCM5qRnfMAZGdsC8pYYQzomVdQpihL9jgwAXoPaie3U",
);
export const AEQI_GOVERNANCE_PROGRAM_ID = new PublicKey(
  "5WHpPFf2mPYNFjr5p3ujeRcZNPoqWMBMkYnsWb2YtyNq",
);
export const AEQI_ROLE_PROGRAM_ID = new PublicKey("4GSrvANBi1yrn3w4VgoxvVz7pH9BdR8MeyUpH4ZcGXpB");
export const AEQI_TOKEN_PROGRAM_ID = new PublicKey("AxyYnv99gnKJ3VMYbyVjz4BxP8LA34CUnhHGVifrc3Kh");
export const AEQI_TREASURY_PROGRAM_ID = new PublicKey(
  "2KBH4dhAM8fvix5sB44f55Hy6mE4HgeMMbm3htZTJNm7",
);
export const AEQI_TRUST_PROGRAM_ID = new PublicKey("CCbs4TCqE6FXmRdyLexx2rSSHAShymWrrR9QWeJUJbXV");
export const AEQI_UNIFUTURES_PROGRAM_ID = new PublicKey(
  "CAz7bt2gLYTe3VUZ4xEyF8AA8syth4NkUKb5c1NRq8JF",
);
export const AEQI_VESTING_PROGRAM_ID = new PublicKey(
  "DCZKRmxjUyAZ3nptbkCBnAGqTe4E7xTvXfLbnf95uj7y",
);

/* ------------------------------------------------------------------ */
/* Sentinel bytes / module IDs (pad32 prefixes).                      */
/* ------------------------------------------------------------------ */

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

function pad32(prefix: Uint8Array | string): Uint8Array {
  const out = new Uint8Array(32);
  const bytes = typeof prefix === "string" ? utf8(prefix) : prefix;
  if (bytes.length > 32) {
    throw new Error(`pad32 prefix exceeds 32 bytes (got ${bytes.length})`);
  }
  out.set(bytes, 0);
  return out;
}

/** Canonical AEQI module IDs (mirror provisioner constants). */
export const ROLE_MODULE_ID = pad32("R");
export const TOKEN_MODULE_ID = pad32("T");
export const GOV_MODULE_ID = pad32("G");
export const UNIFUTURES_MODULE_ID = pad32("U");

/** Genesis curve sentinel (`pad32(b"GENESIS")`). */
export const GENESIS_CURVE_ID = pad32("GENESIS");

/**
 * Stable key the factory writes the token's borsh-encoded `TokenInitConfig`
 * blob under in the trust's BytesConfig slot. Mirrors
 * `aeqi_token::TOKEN_CONFIG_KEY` (single tag byte 0x01, rest zero) and the
 * Rust mirror at provisioner.rs:70.
 */
export const TOKEN_CONFIG_KEY: Uint8Array = (() => {
  const k = new Uint8Array(32);
  k[0] = 1;
  return k;
})();

/* ------------------------------------------------------------------ */
/* PDA derivations.                                                    */
/* ------------------------------------------------------------------ */

function findPda(seeds: Uint8Array[], programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(seeds, programId);
  return pda;
}

/** `seeds = [b"trust", trust_id]` against `AEQI_TRUST_PROGRAM_ID`. */
export function deriveTrustPda(trustId: Uint8Array): PublicKey {
  if (trustId.length !== 32) {
    throw new Error(`trustId must be exactly 32 bytes (got ${trustId.length})`);
  }
  return findPda([utf8("trust"), trustId], AEQI_TRUST_PROGRAM_ID);
}

/** `seeds = [b"module", trust_pda, module_id]` against `AEQI_TRUST_PROGRAM_ID`. */
export function deriveModulePda(trustPda: PublicKey, moduleId: Uint8Array): PublicKey {
  if (moduleId.length !== 32) {
    throw new Error(`moduleId must be exactly 32 bytes (got ${moduleId.length})`);
  }
  return findPda([utf8("module"), trustPda.toBytes(), moduleId], AEQI_TRUST_PROGRAM_ID);
}

/** `seeds = [b"role_module", trust_pda]` against `AEQI_ROLE_PROGRAM_ID`. */
export function deriveRoleModuleStatePda(trustPda: PublicKey): PublicKey {
  return findPda([utf8("role_module"), trustPda.toBytes()], AEQI_ROLE_PROGRAM_ID);
}

/** `seeds = [b"token_module", trust_pda]` against `AEQI_TOKEN_PROGRAM_ID`. */
export function deriveTokenModuleStatePda(trustPda: PublicKey): PublicKey {
  return findPda([utf8("token_module"), trustPda.toBytes()], AEQI_TOKEN_PROGRAM_ID);
}

/** `seeds = [b"gov_module", trust_pda]` against `AEQI_GOVERNANCE_PROGRAM_ID`. */
export function deriveGovernanceModuleStatePda(trustPda: PublicKey): PublicKey {
  return findPda([utf8("gov_module"), trustPda.toBytes()], AEQI_GOVERNANCE_PROGRAM_ID);
}

/**
 * `seeds = [b"treasury_module", trust_pda]` against `AEQI_TREASURY_PROGRAM_ID`.
 * Verified against `programs/aeqi-treasury/src/lib.rs:135`.
 */
export function deriveTreasuryModuleStatePda(trustPda: PublicKey): PublicKey {
  return findPda([utf8("treasury_module"), trustPda.toBytes()], AEQI_TREASURY_PROGRAM_ID);
}

/**
 * `seeds = [b"treasury_vault_authority", trust_pda]` against
 * `AEQI_TREASURY_PROGRAM_ID`. Verified against
 * `programs/aeqi-treasury/src/lib.rs:86,155,176`.
 */
export function deriveTreasuryVaultAuthorityPda(trustPda: PublicKey): PublicKey {
  return findPda([utf8("treasury_vault_authority"), trustPda.toBytes()], AEQI_TREASURY_PROGRAM_ID);
}

/** `seeds = [b"unifutures_module", trust_pda]` against `AEQI_UNIFUTURES_PROGRAM_ID`. */
export function deriveUnifuturesModuleStatePda(trustPda: PublicKey): PublicKey {
  return findPda([utf8("unifutures_module"), trustPda.toBytes()], AEQI_UNIFUTURES_PROGRAM_ID);
}

/** `seeds = [b"mint", trust_pda]` against `AEQI_TOKEN_PROGRAM_ID`. */
export function deriveTokenMintPda(trustPda: PublicKey): PublicKey {
  return findPda([utf8("mint"), trustPda.toBytes()], AEQI_TOKEN_PROGRAM_ID);
}

/** `seeds = [b"token_authority", trust_pda]` against `AEQI_TOKEN_PROGRAM_ID`. */
export function deriveTokenAuthorityPda(trustPda: PublicKey): PublicKey {
  return findPda([utf8("token_authority"), trustPda.toBytes()], AEQI_TOKEN_PROGRAM_ID);
}

/**
 * `seeds = [b"curve", trust_pda, GENESIS_CURVE_ID]` against
 * `AEQI_UNIFUTURES_PROGRAM_ID`.
 */
export function deriveGenesisCurvePda(trustPda: PublicKey): PublicKey {
  return findPda([utf8("curve"), trustPda.toBytes(), GENESIS_CURVE_ID], AEQI_UNIFUTURES_PROGRAM_ID);
}

/**
 * `seeds = [b"curve_authority", trust_pda, GENESIS_CURVE_ID]` against
 * `AEQI_UNIFUTURES_PROGRAM_ID`.
 */
export function deriveGenesisCurveAuthorityPda(trustPda: PublicKey): PublicKey {
  return findPda(
    [utf8("curve_authority"), trustPda.toBytes(), GENESIS_CURVE_ID],
    AEQI_UNIFUTURES_PROGRAM_ID,
  );
}

/**
 * BytesConfig PDA the factory writes the token's `TokenInitConfig` into at
 * `TOKEN_CONFIG_KEY`. Owned by `aeqi_trust`; `aeqi_token::finalize` reads
 * the bytes back at decode time. Mirrors `derive_token_bytes_config_pda`
 * (provisioner.rs:315).
 */
export function deriveTokenBytesConfigPda(trustPda: PublicKey): PublicKey {
  return findPda([utf8("cfg_bytes"), trustPda.toBytes(), TOKEN_CONFIG_KEY], AEQI_TRUST_PROGRAM_ID);
}

/**
 * Standard SPL Associated Token Address. Pass `isToken2022 = true` for
 * tokens minted under the Token-2022 program (the default for AEQI-issued
 * mints); `false` falls back to legacy SPL Token. Spec match:
 * provisioner.rs:287-297.
 */
export function deriveAssociatedTokenAddress(
  owner: PublicKey,
  mint: PublicKey,
  isToken2022: boolean,
): PublicKey {
  return getAssociatedTokenAddressSync(
    mint,
    owner,
    true /* allowOwnerOffCurve — PDAs are off-curve */,
    isToken2022 ? TOKEN_2022_PROGRAM_ID : undefined,
  );
}
