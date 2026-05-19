/**
 * Friendly-name registry for the 11 canonical AEQI Solana programs.
 *
 * Given a base58 program ID, returns the human-readable module name
 * (`aeqi_role`, `aeqi_token`, etc.) used across the on-chain Anchor
 * crates. Surfaces like the Incorporation module list use this to
 * label `Module.program_id` rows without forcing the user to recognize
 * a 44-character pubkey.
 *
 * Source of truth: `apps/ui/src/solana/pdas.ts` AEQI_*_PROGRAM_ID
 * constants, which mirror `projects/aeqi-solana/Anchor.toml`. Add an
 * entry here whenever a new canonical AEQI program is added to the
 * registry.
 */
import {
  AEQI_BUDGET_PROGRAM_ID,
  AEQI_FACTORY_PROGRAM_ID,
  AEQI_FUND_PROGRAM_ID,
  AEQI_FUNDING_PROGRAM_ID,
  AEQI_GOVERNANCE_PROGRAM_ID,
  AEQI_ROLE_PROGRAM_ID,
  AEQI_TOKEN_PROGRAM_ID,
  AEQI_TREASURY_PROGRAM_ID,
  AEQI_TRUST_PROGRAM_ID,
  AEQI_UNIFUTURES_PROGRAM_ID,
  AEQI_VESTING_PROGRAM_ID,
} from "./pdas";

/** Base58 program ID → snake_case program name. */
export const AEQI_PROGRAM_NAMES: Record<string, string> = {
  [AEQI_BUDGET_PROGRAM_ID.toBase58()]: "aeqi_budget",
  [AEQI_FACTORY_PROGRAM_ID.toBase58()]: "aeqi_factory",
  [AEQI_FUND_PROGRAM_ID.toBase58()]: "aeqi_fund",
  [AEQI_FUNDING_PROGRAM_ID.toBase58()]: "aeqi_funding",
  [AEQI_GOVERNANCE_PROGRAM_ID.toBase58()]: "aeqi_governance",
  [AEQI_ROLE_PROGRAM_ID.toBase58()]: "aeqi_role",
  [AEQI_TOKEN_PROGRAM_ID.toBase58()]: "aeqi_token",
  [AEQI_TREASURY_PROGRAM_ID.toBase58()]: "aeqi_treasury",
  [AEQI_TRUST_PROGRAM_ID.toBase58()]: "aeqi_trust",
  [AEQI_UNIFUTURES_PROGRAM_ID.toBase58()]: "aeqi_unifutures",
  [AEQI_VESTING_PROGRAM_ID.toBase58()]: "aeqi_vesting",
};

/**
 * Resolve a base58 program ID to its friendly AEQI program name.
 * Returns `null` for unknown programs so callers can fall back to the
 * raw pubkey (e.g. third-party modules a TRUST has adopted).
 */
export function getAeqiProgramName(programId: string): string | null {
  return AEQI_PROGRAM_NAMES[programId] ?? null;
}
