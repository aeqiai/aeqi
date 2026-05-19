/**
 * Barrel export for the shared Solana client foundation.
 *
 * Surface modules (Overview / Roles / Assets / Equity / Quorum /
 * Incorporation) should import from `@/solana`, not from the sub-files,
 * so the future indexer HTTP layer can slip in without touching every
 * caller.
 */
export { getConnection, getAnchorProvider } from "./client";
export {
  getProgram,
  getBudgetProgram,
  getFactoryProgram,
  getFundProgram,
  getFundingProgram,
  getGovernanceProgram,
  getRoleProgram,
  getTokenProgram,
  getTreasuryProgram,
  getTrustProgram,
  getUnifuturesProgram,
  getVestingProgram,
} from "./programs";
export { readTrust, readModules, readRoles } from "./incorporation";
export type {
  TrustAccount,
  ModuleAccount,
  ModuleAccountWithPda,
  RoleAccount,
  RoleAccountWithPda,
} from "./incorporation";
export {
  readTreasuryModuleState,
  readVaultHoldings,
  readBudgets,
  readVestingCount,
  lookupTokenMeta,
  TOKEN_REGISTRY,
} from "./assets";
export type {
  BudgetAccount,
  BudgetAccountWithPda,
  TreasuryModuleStateAccount,
  TreasuryVault,
  VaultHolding,
  VestingPositionAccount,
} from "./assets";
export {
  readTokenModuleState,
  readMint,
  readHolders,
  readVestingPositions,
  deriveCapTableMintPda,
} from "./equity";
export type { TokenModuleStateAccount, VestingPositionWithPda, TokenHolder } from "./equity";
export {
  readGovernanceConfigs,
  readProposals,
  readRoleTypes,
  deriveProposalStatus,
  votingModeFor,
  findRoleTypeById,
  isTokenModeId,
  isSnapshotPending,
} from "./quorum";
export type {
  GovernanceConfigAccount,
  GovernanceConfigWithPda,
  ProposalAccount,
  ProposalWithPda,
  ProposalStatus,
  RoleTypeAccount,
  RoleTypeWithPda,
  VotingMode,
} from "./quorum";
export { AEQI_PROGRAM_NAMES, getAeqiProgramName } from "./program-names";
export {
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
  ROLE_MODULE_ID,
  TOKEN_MODULE_ID,
  GOV_MODULE_ID,
  UNIFUTURES_MODULE_ID,
  GENESIS_CURVE_ID,
  TOKEN_CONFIG_KEY,
  deriveTrustPda,
  deriveModulePda,
  deriveRoleModuleStatePda,
  deriveTokenModuleStatePda,
  deriveGovernanceModuleStatePda,
  deriveTreasuryModuleStatePda,
  deriveTreasuryVaultAuthorityPda,
  deriveUnifuturesModuleStatePda,
  deriveTokenMintPda,
  deriveTokenAuthorityPda,
  deriveGenesisCurvePda,
  deriveGenesisCurveAuthorityPda,
  deriveTokenBytesConfigPda,
  deriveAssociatedTokenAddress,
} from "./pdas";
