/**
 * Typed Anchor `Program<IDL>` accessors for each of the 11 AEQI
 * Solana programs. Wraps `getAnchorProvider()` from `./client` and the
 * IDL JSON files synced into `./generated/idl/` by
 * `scripts/sync-solana-idls.mjs`.
 *
 * Usage from a per-surface read module:
 *
 *   import { getTrustProgram } from "@/solana";
 *
 *   const program = getTrustProgram();
 *   const trustAccount = await program.account.trust.fetch(trustPda);
 *
 * All programs are read-only from the browser — see `client.ts` for the
 * read-only-by-construction rationale.
 */
import { Program, type Idl } from "@coral-xyz/anchor";

import { getAnchorProvider } from "./client";

import aeqiBudgetIdl from "./generated/idl/aeqi_budget.json";
import aeqiFactoryIdl from "./generated/idl/aeqi_factory.json";
import aeqiFundIdl from "./generated/idl/aeqi_fund.json";
import aeqiFundingIdl from "./generated/idl/aeqi_funding.json";
import aeqiGovernanceIdl from "./generated/idl/aeqi_governance.json";
import aeqiRoleIdl from "./generated/idl/aeqi_role.json";
import aeqiTokenIdl from "./generated/idl/aeqi_token.json";
import aeqiTreasuryIdl from "./generated/idl/aeqi_treasury.json";
import aeqiTrustIdl from "./generated/idl/aeqi_trust.json";
import aeqiUnifuturesIdl from "./generated/idl/aeqi_unifutures.json";
import aeqiVestingIdl from "./generated/idl/aeqi_vesting.json";

import type { AeqiBudget } from "./generated/types/aeqi_budget";
import type { AeqiFactory } from "./generated/types/aeqi_factory";
import type { AeqiFund } from "./generated/types/aeqi_fund";
import type { AeqiFunding } from "./generated/types/aeqi_funding";
import type { AeqiGovernance } from "./generated/types/aeqi_governance";
import type { AeqiRole } from "./generated/types/aeqi_role";
import type { AeqiToken } from "./generated/types/aeqi_token";
import type { AeqiTreasury } from "./generated/types/aeqi_treasury";
import type { AeqiTrust } from "./generated/types/aeqi_trust";
import type { AeqiUnifutures } from "./generated/types/aeqi_unifutures";
import type { AeqiVesting } from "./generated/types/aeqi_vesting";

/**
 * Generic factory: wrap an IDL in a typed `Program<IDL>` bound to the
 * shared read-only provider. The `programId` is encoded into the IDL by
 * Anchor at codegen time, so we don't pass it again here.
 */
export function getProgram<T extends Idl>(idl: T): Program<T> {
  return new Program<T>(idl, getAnchorProvider());
}

// Per-program accessors. Each loads the IDL JSON once (via the module
// import) and constructs a fresh `Program` against the shared provider —
// `Program` instances are cheap; the heavy state lives in `Connection`.

export const getBudgetProgram = (): Program<AeqiBudget> =>
  getProgram(aeqiBudgetIdl as unknown as AeqiBudget);

export const getFactoryProgram = (): Program<AeqiFactory> =>
  getProgram(aeqiFactoryIdl as unknown as AeqiFactory);

export const getFundProgram = (): Program<AeqiFund> =>
  getProgram(aeqiFundIdl as unknown as AeqiFund);

export const getFundingProgram = (): Program<AeqiFunding> =>
  getProgram(aeqiFundingIdl as unknown as AeqiFunding);

export const getGovernanceProgram = (): Program<AeqiGovernance> =>
  getProgram(aeqiGovernanceIdl as unknown as AeqiGovernance);

export const getRoleProgram = (): Program<AeqiRole> =>
  getProgram(aeqiRoleIdl as unknown as AeqiRole);

export const getTokenProgram = (): Program<AeqiToken> =>
  getProgram(aeqiTokenIdl as unknown as AeqiToken);

export const getTreasuryProgram = (): Program<AeqiTreasury> =>
  getProgram(aeqiTreasuryIdl as unknown as AeqiTreasury);

export const getTrustProgram = (): Program<AeqiTrust> =>
  getProgram(aeqiTrustIdl as unknown as AeqiTrust);

export const getUnifuturesProgram = (): Program<AeqiUnifutures> =>
  getProgram(aeqiUnifuturesIdl as unknown as AeqiUnifutures);

export const getVestingProgram = (): Program<AeqiVesting> =>
  getProgram(aeqiVestingIdl as unknown as AeqiVesting);
