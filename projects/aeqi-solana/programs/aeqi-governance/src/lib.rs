//! aeqi_governance — proposal lifecycle + voting.
//!
//! Two voting modes selected per proposal via `governance_config_id`:
//!
//! - `governance_config_id == [0u8; 32]` → token-weighted voting (CPI into
//!   `aeqi_token` for vote power at proposal start slot).
//! - `governance_config_id == role_type_id` → per-role multisig (CPI into
//!   `aeqi_role::get_past_role_votes`).
//!
//! Proposal state machine: Pending → Active → (Defeated | Succeeded) →
//! Queued → Executed.
//!
//! This iteration: GovernanceConfig + Proposal PDAs + register_config + propose
//! ixes. cast_vote and execute land in subsequent iterations.

// Anchor 0.31 emits external macro warnings under newer Rust check-cfg/deprecation
// lints. Keep this crate's warning output focused on protocol code.
#![allow(deprecated, unexpected_cfgs)]

use aeqi_company::state::Company;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;
use anchor_spl::token_interface::spl_token_2022::{
    extension::StateWithExtensions, state::Mint as SplMint,
};

declare_id!("5WHpPFf2mPYNFjr5p3ujeRcZNPoqWMBMkYnsWb2YtyNq");

/// aeqi_company program id — used for cross-program PDA derivation so module
/// setup paths (init, register_config) cannot accept arbitrary company pubkeys.
pub const AEQI_COMPANY_ID: Pubkey =
    anchor_lang::pubkey!("CCbs4TCqE6FXmRdyLexx2rSSHAShymWrrR9QWeJUJbXV");

/// Hardcoded aeqi_role program ID — used to validate the PDA derivation +
/// account ownership of `voter_checkpoint` in `cast_vote_role`. Avoids a
/// cross-crate dep just to read RoleVoteCheckpoint.account / .count.
pub const AEQI_ROLE_ID: Pubkey =
    anchor_lang::pubkey!("4GSrvANBi1yrn3w4VgoxvVz7pH9BdR8MeyUpH4ZcGXpB");

/// Hardcoded aeqi_token program ID — used to validate the cap-table mint
/// passed to `cast_vote_token` is the canonical PDA `[b"mint", company]`
/// under aeqi_token, so callers can't substitute an unrelated mint.
pub const AEQI_TOKEN_ID: Pubkey =
    anchor_lang::pubkey!("AxyYnv99gnKJ3VMYbyVjz4BxP8LA34CUnhHGVifrc3Kh");

pub const TOKEN_VOTING_CONFIG_ID: [u8; 32] = [0u8; 32];
const BPS_DENOMINATOR: u128 = 10_000;

#[derive(AnchorDeserialize, AnchorSerialize, Clone)]
pub struct RoleTypeConfigData {
    pub vesting: bool,
    pub vesting_cliff: i64,
    pub vesting_duration: i64,
    pub fdv: bool,
    pub fdv_start: u128,
    pub fdv_end: u128,
    pub probationary_period: i64,
    pub severance_period: i64,
    pub contribution: bool,
}

/// Same memory layout as `aeqi_role::RoleType`. Used to read the canonical
/// role supply for per-role governance without accepting caller input.
#[derive(AnchorDeserialize, AnchorSerialize, Clone)]
pub struct RoleTypeData {
    pub company: Pubkey,
    pub role_type_id: [u8; 32],
    pub hierarchy: u32,
    pub config: RoleTypeConfigData,
    pub role_count: u32,
    pub bump: u8,
}

/// Same memory layout as `aeqi_role::RoleVoteCheckpoint`. Used for borsh
/// deserialization of the cross-program account data; the `#[account]`
/// discriminator on the original is handled by skipping the first 8 bytes.
#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct RoleVoteCheckpointData {
    pub account: Pubkey,
    pub role_type_id: [u8; 32],
    pub slot: u64,
    pub count: u64,
    pub bump: u8,
}

#[program]
pub mod aeqi_governance {
    use super::*;

    /// Module init — creates GovernanceModuleState PDA bound to a company.
    /// Gated to the company authority during creation mode so the
    /// module_state PDA cannot be squatted by an attacker.
    pub fn init(ctx: Context<InitGovernance>) -> Result<()> {
        let company = &ctx.accounts.company;
        require!(company.creation_mode, GovernanceError::CompanyNotInCreationMode);
        require_keys_eq!(ctx.accounts.payer.key(), company.authority, GovernanceError::Unauthorized);

        let m = &mut ctx.accounts.module_state;
        m.company = ctx.accounts.company.key();
        m.proposal_count = 0;
        m.config_count = 0;
        m.bump = ctx.bumps.module_state;
        Ok(())
    }

    pub fn finalize(_ctx: Context<FinalizeGovernance>) -> Result<()> {
        Ok(())
    }

    /// Register a governance config (one per voting mode the company supports).
    /// Authority gate: only the company authority can register configs in this
    /// iteration. Once live-mode governance lands, ratified config changes
    /// will flow through `execute_proposal`.
    pub fn register_config(
        ctx: Context<RegisterConfig>,
        governance_config_id: [u8; 32],
        config: GovernanceConfigInput,
    ) -> Result<()> {
        let company = &ctx.accounts.company;
        require_keys_eq!(ctx.accounts.payer.key(), company.authority, GovernanceError::Unauthorized);

        require!(config.quorum_bps <= 10_000, GovernanceError::InvalidBpsValue);
        require!(config.support_bps <= 10_000, GovernanceError::InvalidBpsValue);
        require!(config.quorum_bps > 0, GovernanceError::InvalidBpsValue);
        require!(config.support_bps > 0, GovernanceError::InvalidBpsValue);
        require!(config.voting_period > 0, GovernanceError::ZeroVotingPeriod);

        let g = &mut ctx.accounts.governance_config;
        g.company = ctx.accounts.company.key();
        g.governance_config_id = governance_config_id;
        g.proposal_threshold = config.proposal_threshold;
        g.quorum_bps = config.quorum_bps;
        g.support_bps = config.support_bps;
        g.voting_period = config.voting_period;
        g.execution_delay = config.execution_delay;
        g.allow_early_enact = config.allow_early_enact;
        g.bump = ctx.bumps.governance_config;

        let m = &mut ctx.accounts.module_state;
        bump_config_count(m)?;

        emit!(ConfigRegistered {
            company: g.company,
            governance_config_id,
            quorum_bps: g.quorum_bps,
            support_bps: g.support_bps,
        });
        Ok(())
    }

    /// Execute a proposal that has succeeded. Validates:
    ///   - voting period has ended (or early enact + thresholds met)
    ///   - quorum: (for + abstain) ≥ ceil(totalVoteSupply * quorum_bps / 10000)
    ///   - support: for ≥ ceil((for + against) * support_bps / 10000)
    ///
    /// Remaining accounts:
    ///   0. `GovernanceConfig` PDA matching `proposal.governance_config_id`
    ///   1. vote supply source:
    ///      - token mode (`[0; 32]` config): canonical cap-table mint PDA
    ///      - role mode: canonical `aeqi_role::RoleType` PDA
    ///
    /// On-chain ix dispatch (running the proposed action via remaining_accounts)
    /// is reserved for a follow-up — this iteration just transitions
    /// Proposal.executed → true after threshold gate.
    pub fn execute_proposal(ctx: Context<ExecuteProposal>) -> Result<()> {
        let p = &mut ctx.accounts.proposal;
        require!(!p.executed, GovernanceError::ProposalAlreadyExecuted);
        require!(!p.canceled, GovernanceError::ProposalCanceled);

        let mut remaining_accounts = ctx.remaining_accounts.iter();
        let cfg_acct = remaining_accounts.next().ok_or(error!(GovernanceError::ConfigMismatch))?;
        let cfg =
            load_governance_config(cfg_acct, &p.company, &p.governance_config_id, ctx.program_id)?;
        let vote_supply_acct =
            remaining_accounts.next().ok_or(error!(GovernanceError::MissingVoteSupplyAccount))?;
        let total_vote_supply = load_total_vote_supply(p, vote_supply_acct)?;

        let now = Clock::get()?.unix_timestamp;
        let vote_end = proposal_vote_end(p)?;

        // Allow early enact if config permits AND thresholds already met.
        let voting_ended = now >= vote_end;
        let early_ok = cfg.allow_early_enact;
        require!(voting_ended || early_ok, GovernanceError::VotingNotClosed);

        // Quorum: (for + abstain) ≥ ceil(supply * quorum_bps / 10000)
        let participating = p
            .for_votes
            .checked_add(p.abstain_votes)
            .ok_or(error!(GovernanceError::MathOverflow))?;
        let quorum_required = checked_bps_ceil(total_vote_supply, cfg.quorum_bps)?;
        require!(participating >= quorum_required, GovernanceError::QuorumNotMet);

        // Support: for ≥ ceil((for + against) * support_bps / 10000)
        let decisive = p
            .for_votes
            .checked_add(p.against_votes)
            .ok_or(error!(GovernanceError::MathOverflow))?;
        require!(decisive > 0, GovernanceError::NoDecisiveVotes);
        let support_required = checked_bps_ceil(decisive, cfg.support_bps)?;
        require!(p.for_votes >= support_required, GovernanceError::SupportNotMet);

        // Optional execution delay: enforce now ≥ vote_end + execution_delay
        if cfg.execution_delay > 0 {
            let execution_ready_at = vote_end
                .checked_add(cfg.execution_delay)
                .ok_or(error!(GovernanceError::MathOverflow))?;
            require!(now >= execution_ready_at, GovernanceError::ExecutionDelayNotMet);
        }

        p.succeeded_at = if p.succeeded_at == 0 { now } else { p.succeeded_at };
        p.executed = true;

        emit!(ProposalExecuted {
            company: p.company,
            proposal_id: p.proposal_id,
            for_votes: p.for_votes,
            against_votes: p.against_votes,
            abstain_votes: p.abstain_votes,
            executed_at: now,
        });
        Ok(())
    }

    /// Cast a per-role-multisig vote. Vote power = the voter's
    /// `RoleVoteCheckpoint.count` for the role type designated by the
    /// proposal's governance_config_id. The checkpoint PDA is owned by
    /// `aeqi_role`; we validate its `account` field == voter.
    pub fn cast_vote_role(ctx: Context<CastVoteRole>, choice: u8) -> Result<()> {
        // Validate the cross-program account: must be owned by aeqi_role and
        // its PDA derivation is enforced by Anchor's seeds::program constraint.
        let acct_info = &ctx.accounts.voter_checkpoint;
        require_keys_eq!(*acct_info.owner, AEQI_ROLE_ID, GovernanceError::InvalidCheckpoint);

        let data = acct_info.try_borrow_data()?;
        require!(data.len() >= 8, GovernanceError::InvalidCheckpoint);
        // Skip Anchor's 8-byte discriminator (we already validated ownership).
        let ckpt = RoleVoteCheckpointData::try_from_slice(&data[8..])
            .map_err(|_| error!(GovernanceError::InvalidCheckpoint))?;

        require_keys_eq!(
            ckpt.account,
            ctx.accounts.voter.key(),
            GovernanceError::CheckpointVoterMismatch
        );
        require!(
            ckpt.role_type_id == ctx.accounts.proposal.governance_config_id,
            GovernanceError::ConfigMismatch
        );
        // Snapshot guard: the checkpoint must be no newer than the proposal's
        // snapshot slot. Without this, a voter could accumulate role
        // delegations AFTER the proposal started and replay the freshest
        // checkpoint, inflating their weight beyond what they held at
        // snapshot time. Mirrors `aeqi_role::get_past_role_votes(query_slot)`
        // but enforced directly at the cast_vote consumer (which previously
        // skipped that helper). See idea
        // design/aeqi-governance-proposal-start-snapshots.
        require!(
            ckpt.slot <= ctx.accounts.proposal.snapshot_slot,
            GovernanceError::CheckpointAfterSnapshot
        );

        let weight = ckpt.count as u128;
        require!(weight > 0, GovernanceError::ZeroWeight);

        let p = &mut ctx.accounts.proposal;
        let now = Clock::get()?.unix_timestamp;
        require_vote_open(p, now)?;

        apply_vote_tally(p, choice, weight)?;
        let v = &mut ctx.accounts.vote;
        record_vote(v, p, ctx.accounts.voter.key(), choice, weight, ctx.bumps.vote);
        Ok(())
    }

    /// Cast a token-weighted vote against the proposal's Merkle snapshot
    /// (Phase 2 — see idea design/aeqi-governance-proposal-start-snapshots).
    /// `claimed_balance` is the voter's Token-2022 balance at
    /// `proposal.snapshot_slot`, attested by a Merkle inclusion proof
    /// against `proposal.snapshot_root`. The `vote_record` PDA's
    /// `init` constraint blocks double-voting per (proposal, voter).
    ///
    /// Snapshot must already be committed (`commit_snapshot_root`); voting
    /// with the pre-commitment zero root is rejected to keep the proposal
    /// from being decided against live balances.
    pub fn cast_vote_token(
        ctx: Context<CastVoteToken>,
        choice: u8,
        claimed_balance: u64,
        merkle_proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        require!(
            ctx.accounts.proposal.snapshot_root != [0u8; 32],
            GovernanceError::SnapshotNotCommitted
        );
        require!(claimed_balance > 0, GovernanceError::ZeroWeight);

        let leaf = token_vote_leaf(&ctx.accounts.voter.key(), claimed_balance);
        require!(
            verify_merkle_proof(leaf, &merkle_proof, ctx.accounts.proposal.snapshot_root),
            GovernanceError::InvalidMerkleProof
        );

        let weight = claimed_balance as u128;
        let p = &mut ctx.accounts.proposal;
        let now = Clock::get()?.unix_timestamp;
        require_vote_open(p, now)?;

        apply_vote_tally(p, choice, weight)?;
        let v = &mut ctx.accounts.vote;
        record_vote(v, p, ctx.accounts.voter.key(), choice, weight, ctx.bumps.vote);
        Ok(())
    }

    /// Commit a Merkle root over (holder, balance) leaves snapshotted at
    /// `proposal.snapshot_slot`. Permissionless — anyone (typically the
    /// off-chain indexer's snapshot job) can call it once per proposal.
    ///
    /// Guards:
    ///   - existing root must be zero (one-shot commit)
    ///   - current slot must be STRICTLY greater than `snapshot_slot` so
    ///     the snapshotter has only ever seen finalized balances at the
    ///     target slot (prevents racing mints/burns at the same slot)
    ///
    /// `total_supply_snapshot` is recorded as protocol metadata; per-vote
    /// correctness is enforced by Merkle proof verification in
    /// `cast_vote_token`, not by trusting the caller's totals.
    pub fn commit_snapshot_root(
        ctx: Context<CommitSnapshotRoot>,
        root: [u8; 32],
        total_supply_snapshot: u64,
    ) -> Result<()> {
        require!(root != [0u8; 32], GovernanceError::InvalidMerkleProof);
        let current_slot = Clock::get()?.slot;
        let p = &mut ctx.accounts.proposal;
        require!(p.snapshot_root == [0u8; 32], GovernanceError::CommitRootMismatch);
        require!(current_slot > p.snapshot_slot, GovernanceError::SnapshotSlotNotYetReached);

        p.snapshot_root = root;
        p.snapshot_total_supply = total_supply_snapshot;

        emit!(SnapshotRootCommitted {
            company: p.company,
            proposal_id: p.proposal_id,
            snapshot_slot: p.snapshot_slot,
            snapshot_root: root,
            total_supply_snapshot,
        });
        Ok(())
    }

    /// Deprecated compatibility entrypoint. Generic votes are disabled because
    /// caller-supplied weight is not tied to token or role state. Use
    /// `cast_vote_token` or `cast_vote_role` instead.
    pub fn cast_vote(_ctx: Context<CastVote>, _choice: u8, _weight: u128) -> Result<()> {
        err!(GovernanceError::GenericVotingDisabled)
    }

    /// Create a proposal under a registered governance config. Per-proposal
    /// mode selection via `governance_config_id`.
    pub fn propose(
        ctx: Context<Propose>,
        proposal_id: [u8; 32],
        governance_config_id: [u8; 32],
        ipfs_cid: [u8; 64],
    ) -> Result<()> {
        let cfg_acct =
            ctx.remaining_accounts.first().ok_or(error!(GovernanceError::ConfigMismatch))?;
        let cfg = load_governance_config(
            cfg_acct,
            &ctx.accounts.company.key(),
            &governance_config_id,
            ctx.program_id,
        )?;

        let clock = Clock::get()?;
        let now = clock.unix_timestamp;
        let p = &mut ctx.accounts.proposal;
        p.company = ctx.accounts.company.key();
        p.proposal_id = proposal_id;
        p.governance_config_id = governance_config_id;
        p.proposer = ctx.accounts.proposer.key();
        p.ipfs_cid = ipfs_cid;
        p.vote_start = now;
        // snapshot_slot bounds the maximum role checkpoint slot that
        // cast_vote_role will accept. Set at proposal creation so vote power
        // is fixed to delegations held when voting opened, not whatever
        // accumulates while voting is live. Phase 2 (token Merkle snapshot,
        // ae-008) layers token weight onto the same slot.
        p.snapshot_slot = clock.slot;
        p.snapshot_root = [0u8; 32];
        p.snapshot_total_supply = 0;
        p.vote_duration = cfg.voting_period;
        p.execution_delay = cfg.execution_delay;
        p.for_votes = 0;
        p.against_votes = 0;
        p.abstain_votes = 0;
        p.executed = false;
        p.canceled = false;
        p.succeeded_at = 0;
        p.bump = ctx.bumps.proposal;

        let m = &mut ctx.accounts.module_state;
        m.proposal_count =
            m.proposal_count.checked_add(1).ok_or(error!(GovernanceError::MathOverflow))?;

        emit!(ProposalCreated {
            company: p.company,
            proposal_id,
            governance_config_id,
            proposer: p.proposer,
            vote_start: p.vote_start,
            vote_duration: p.vote_duration,
        });
        Ok(())
    }
}

fn proposal_vote_end(p: &Proposal) -> Result<i64> {
    p.vote_start.checked_add(p.vote_duration).ok_or(error!(GovernanceError::MathOverflow))
}

fn checked_bps_ceil(value: u128, bps: u16) -> Result<u128> {
    let numerator = value.checked_mul(bps as u128).ok_or(error!(GovernanceError::MathOverflow))?;
    numerator
        .checked_add(BPS_DENOMINATOR - 1)
        .ok_or(error!(GovernanceError::MathOverflow))?
        .checked_div(BPS_DENOMINATOR)
        .ok_or(error!(GovernanceError::MathOverflow))
}

fn load_total_vote_supply(proposal: &Proposal, vote_supply_acct: &AccountInfo) -> Result<u128> {
    if proposal.governance_config_id == TOKEN_VOTING_CONFIG_ID {
        load_token_vote_supply(proposal, vote_supply_acct)
    } else {
        load_role_vote_supply(proposal, vote_supply_acct)
    }
}

fn load_token_vote_supply(proposal: &Proposal, mint_acct: &AccountInfo) -> Result<u128> {
    let (expected_mint, _) =
        Pubkey::find_program_address(&[b"mint", proposal.company.as_ref()], &AEQI_TOKEN_ID);
    require_keys_eq!(mint_acct.key(), expected_mint, GovernanceError::VoteSupplyAccountMismatch);
    require!(
        *mint_acct.owner == anchor_spl::token::ID || *mint_acct.owner == anchor_spl::token_2022::ID,
        GovernanceError::InvalidVoteSupplyAccount
    );

    let data = mint_acct
        .try_borrow_data()
        .map_err(|_| error!(GovernanceError::InvalidVoteSupplyAccount))?;
    let mint = StateWithExtensions::<SplMint>::unpack(&data)
        .map_err(|_| error!(GovernanceError::InvalidVoteSupplyAccount))?;
    let supply = mint.base.supply as u128;
    require!(supply > 0, GovernanceError::ZeroVoteSupply);
    Ok(supply)
}

fn load_role_vote_supply(proposal: &Proposal, role_type_acct: &AccountInfo) -> Result<u128> {
    let (expected_role_type, _) = Pubkey::find_program_address(
        &[b"role_type", proposal.company.as_ref(), proposal.governance_config_id.as_ref()],
        &AEQI_ROLE_ID,
    );
    require_keys_eq!(
        role_type_acct.key(),
        expected_role_type,
        GovernanceError::VoteSupplyAccountMismatch
    );
    require_keys_eq!(
        *role_type_acct.owner,
        AEQI_ROLE_ID,
        GovernanceError::InvalidVoteSupplyAccount
    );

    let data = role_type_acct
        .try_borrow_data()
        .map_err(|_| error!(GovernanceError::InvalidVoteSupplyAccount))?;
    require!(data.len() >= 8, GovernanceError::InvalidVoteSupplyAccount);
    let role_type = RoleTypeData::try_from_slice(&data[8..])
        .map_err(|_| error!(GovernanceError::InvalidVoteSupplyAccount))?;
    require_keys_eq!(role_type.company, proposal.company, GovernanceError::VoteSupplyAccountMismatch);
    require!(
        role_type.role_type_id == proposal.governance_config_id,
        GovernanceError::VoteSupplyAccountMismatch
    );

    let supply = role_type.role_count as u128;
    require!(supply > 0, GovernanceError::ZeroVoteSupply);
    Ok(supply)
}

fn require_vote_open(p: &Proposal, now: i64) -> Result<()> {
    require!(!p.executed, GovernanceError::ProposalAlreadyExecuted);
    require!(!p.canceled, GovernanceError::ProposalCanceled);
    require!(now >= p.vote_start, GovernanceError::VotingNotStarted);
    require!(now < proposal_vote_end(p)?, GovernanceError::VotingClosed);
    Ok(())
}

fn record_vote(
    vote: &mut Account<VoteRecord>,
    proposal: &Proposal,
    voter: Pubkey,
    choice: u8,
    weight: u128,
    bump: u8,
) {
    vote.company = proposal.company;
    vote.proposal_id = proposal.proposal_id;
    vote.voter = voter;
    vote.choice = choice;
    vote.weight = weight;
    vote.bump = bump;
}

fn apply_vote_tally(proposal: &mut Account<Proposal>, choice: u8, weight: u128) -> Result<()> {
    require!(choice <= 2, GovernanceError::InvalidVoteChoice);
    match choice {
        0 => {
            proposal.against_votes = proposal
                .against_votes
                .checked_add(weight)
                .ok_or(error!(GovernanceError::MathOverflow))?
        }
        1 => {
            proposal.for_votes = proposal
                .for_votes
                .checked_add(weight)
                .ok_or(error!(GovernanceError::MathOverflow))?
        }
        2 => {
            proposal.abstain_votes = proposal
                .abstain_votes
                .checked_add(weight)
                .ok_or(error!(GovernanceError::MathOverflow))?
        }
        _ => unreachable!(),
    }
    Ok(())
}

/// Canonical token-vote leaf shape: `sha256(voter_pubkey || u64_le(balance))`.
/// Same encoding the indexer's snapshot job uses; mismatched encodings on
/// either side surface as `InvalidMerkleProof` at vote time.
pub fn token_vote_leaf(voter: &Pubkey, balance: u64) -> [u8; 32] {
    let mut buf = [0u8; 40];
    buf[..32].copy_from_slice(&voter.to_bytes());
    buf[32..].copy_from_slice(&balance.to_le_bytes());
    hashv(&[&buf]).to_bytes()
}

/// Sorted-pair Merkle proof verification — at each step we hash
/// `min(current, sibling) || max(current, sibling)` so the snapshotter
/// doesn't need to publish per-step LEFT/RIGHT bits alongside the proof.
/// This matches Hop/Optimism's standard pattern (OpenZeppelin's
/// `MerkleProof.verify`).
pub fn verify_merkle_proof(leaf: [u8; 32], proof: &[[u8; 32]], root: [u8; 32]) -> bool {
    let mut current = leaf;
    for sibling in proof {
        current = if current <= *sibling {
            hashv(&[&current, sibling]).to_bytes()
        } else {
            hashv(&[sibling, &current]).to_bytes()
        };
    }
    current == root
}

fn bump_config_count(module_state: &mut Account<GovernanceModuleState>) -> Result<()> {
    module_state.config_count =
        module_state.config_count.checked_add(1).ok_or(error!(GovernanceError::MathOverflow))?;
    Ok(())
}

fn load_governance_config(
    cfg_acct: &AccountInfo,
    company: &Pubkey,
    governance_config_id: &[u8; 32],
    program_id: &Pubkey,
) -> Result<GovernanceConfig> {
    let (expected_cfg, _) = Pubkey::find_program_address(
        &[b"gov_config", company.as_ref(), governance_config_id],
        program_id,
    );
    require_keys_eq!(cfg_acct.key(), expected_cfg, GovernanceError::ConfigMismatch);
    require_keys_eq!(*cfg_acct.owner, *program_id, GovernanceError::ConfigMismatch);

    let data = cfg_acct.try_borrow_data().map_err(|_| error!(GovernanceError::ConfigMismatch))?;
    let discriminator = GovernanceConfig::DISCRIMINATOR;
    require!(data.len() >= discriminator.len(), GovernanceError::ConfigMismatch);
    require!(&data[..discriminator.len()] == discriminator, GovernanceError::ConfigMismatch);

    let cfg = GovernanceConfig::try_from_slice(&data[discriminator.len()..])
        .map_err(|_| error!(GovernanceError::ConfigMismatch))?;
    require_keys_eq!(cfg.company, *company, GovernanceError::ConfigMismatch);
    require!(cfg.governance_config_id == *governance_config_id, GovernanceError::ConfigMismatch);
    Ok(cfg)
}

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct GovernanceModuleState {
    pub company: Pubkey,
    pub proposal_count: u64,
    pub config_count: u32,
    pub bump: u8,
}

/// One per voting mode.
#[account]
#[derive(InitSpace)]
pub struct GovernanceConfig {
    pub company: Pubkey,
    pub governance_config_id: [u8; 32],
    pub proposal_threshold: u128,
    pub quorum_bps: u16,
    pub support_bps: u16,
    pub voting_period: i64,
    pub execution_delay: i64,
    pub allow_early_enact: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct GovernanceConfigInput {
    pub proposal_threshold: u128,
    pub quorum_bps: u16,
    pub support_bps: u16,
    pub voting_period: i64,
    pub execution_delay: i64,
    pub allow_early_enact: bool,
}

/// One per (proposal, voter) pair — init enforces single-vote-per-voter.
#[account]
#[derive(InitSpace)]
pub struct VoteRecord {
    pub company: Pubkey,
    pub proposal_id: [u8; 32],
    pub voter: Pubkey,
    pub choice: u8, // 0 = against, 1 = for, 2 = abstain
    pub weight: u128,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Proposal {
    pub company: Pubkey,
    pub proposal_id: [u8; 32],
    pub governance_config_id: [u8; 32],
    pub proposer: Pubkey,
    pub ipfs_cid: [u8; 64],
    pub vote_start: i64,
    pub vote_duration: i64,
    pub execution_delay: i64,
    /// Solana slot captured at `propose()` time. `cast_vote_role` rejects
    /// any RoleVoteCheckpoint whose `slot` is greater than this — locking
    /// vote power to delegations held when the proposal opened. Phase 1
    /// of design/aeqi-governance-proposal-start-snapshots; Phase 2 (ae-008)
    /// reuses the same slot for token Merkle snapshots.
    pub snapshot_slot: u64,
    /// Merkle root over (holder_pubkey, balance) leaves at
    /// `snapshot_slot`, committed once by `commit_snapshot_root` (Phase 2,
    /// ae-008). Initialized to `[0; 32]` at `propose()`; `cast_vote_token`
    /// rejects votes until the indexer's snapshot job commits the real
    /// root.
    pub snapshot_root: [u8; 32],
    /// Sum of all holder balances at `snapshot_slot`, published alongside
    /// `snapshot_root` for downstream quorum/supply reporting. Not used
    /// in per-vote enforcement (Merkle proofs are the gate); kept as
    /// protocol metadata.
    pub snapshot_total_supply: u64,
    pub for_votes: u128,
    pub against_votes: u128,
    pub abstain_votes: u128,
    pub executed: bool,
    pub canceled: bool,
    pub succeeded_at: i64,
    pub bump: u8,
}

// -----------------------------------------------------------------------------
// Account contexts
// -----------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitGovernance<'info> {
    /// Company PDA — must be a real Company account owned by aeqi_company.
    #[account(
        seeds = [b"company", company.company_id.as_ref()],
        bump = company.bump,
        seeds::program = AEQI_COMPANY_ID,
    )]
    pub company: Account<'info, Company>,
    #[account(
        init,
        payer = payer,
        space = 8 + GovernanceModuleState::INIT_SPACE,
        seeds = [b"gov_module", company.key().as_ref()],
        bump,
    )]
    pub module_state: Account<'info, GovernanceModuleState>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FinalizeGovernance<'info> {
    /// CHECK: company pda
    pub company: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(governance_config_id: [u8; 32])]
pub struct RegisterConfig<'info> {
    /// Company PDA — must be a real Company account owned by aeqi_company.
    #[account(
        seeds = [b"company", company.company_id.as_ref()],
        bump = company.bump,
        seeds::program = AEQI_COMPANY_ID,
    )]
    pub company: Account<'info, Company>,
    #[account(
        mut,
        seeds = [b"gov_module", company.key().as_ref()],
        bump = module_state.bump,
    )]
    pub module_state: Account<'info, GovernanceModuleState>,
    #[account(
        init,
        payer = payer,
        space = 8 + GovernanceConfig::INIT_SPACE,
        seeds = [b"gov_config", company.key().as_ref(), governance_config_id.as_ref()],
        bump,
    )]
    pub governance_config: Account<'info, GovernanceConfig>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(proposal_id: [u8; 32], governance_config_id: [u8; 32])]
pub struct Propose<'info> {
    /// CHECK: company pda
    pub company: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"gov_module", company.key().as_ref()],
        bump = module_state.bump,
    )]
    pub module_state: Account<'info, GovernanceModuleState>,
    #[account(
        init,
        payer = proposer,
        space = 8 + Proposal::INIT_SPACE,
        seeds = [b"proposal", company.key().as_ref(), proposal_id.as_ref()],
        bump,
    )]
    pub proposal: Account<'info, Proposal>,
    #[account(mut)]
    pub proposer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteProposal<'info> {
    #[account(
        mut,
        seeds = [b"proposal", proposal.company.as_ref(), proposal.proposal_id.as_ref()],
        bump = proposal.bump,
    )]
    pub proposal: Account<'info, Proposal>,
    pub executor: Signer<'info>,
}

#[derive(Accounts)]
pub struct CastVoteRole<'info> {
    #[account(
        mut,
        seeds = [b"proposal", proposal.company.as_ref(), proposal.proposal_id.as_ref()],
        bump = proposal.bump,
    )]
    pub proposal: Account<'info, Proposal>,
    #[account(
        init,
        payer = voter,
        space = 8 + VoteRecord::INIT_SPACE,
        seeds = [b"vote", proposal.company.as_ref(), proposal.proposal_id.as_ref(), voter.key().as_ref()],
        bump,
    )]
    pub vote: Account<'info, VoteRecord>,
    /// CHECK: voter's role-vote checkpoint PDA, owned by aeqi_role. PDA
    /// derivation is enforced by `seeds::program = AEQI_ROLE_ID`; the
    /// handler verifies ownership and borsh-decodes the data manually.
    #[account(
        seeds = [
            b"role_ckpt",
            proposal.company.as_ref(),
            proposal.governance_config_id.as_ref(),
            voter.key().as_ref(),
        ],
        bump,
        seeds::program = AEQI_ROLE_ID,
    )]
    pub voter_checkpoint: UncheckedAccount<'info>,
    #[account(mut)]
    pub voter: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CastVoteToken<'info> {
    #[account(
        mut,
        seeds = [b"proposal", proposal.company.as_ref(), proposal.proposal_id.as_ref()],
        bump = proposal.bump,
    )]
    pub proposal: Account<'info, Proposal>,
    /// Single-vote-per-voter gate. `init` rejects a second cast with
    /// "already in use", which is the desired error from a UX standpoint
    /// and saves us a separate `DoubleVote` error variant.
    #[account(
        init,
        payer = voter,
        space = 8 + VoteRecord::INIT_SPACE,
        seeds = [b"vote", proposal.company.as_ref(), proposal.proposal_id.as_ref(), voter.key().as_ref()],
        bump,
    )]
    pub vote: Account<'info, VoteRecord>,
    #[account(mut)]
    pub voter: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CommitSnapshotRoot<'info> {
    #[account(
        mut,
        seeds = [b"proposal", proposal.company.as_ref(), proposal.proposal_id.as_ref()],
        bump = proposal.bump,
    )]
    pub proposal: Account<'info, Proposal>,
    /// Permissionless caller — the snapshot job pays rent for the tx and
    /// the program enforces one-shot via `proposal.snapshot_root == [0; 32]`.
    pub committer: Signer<'info>,
}

#[derive(Accounts)]
pub struct CastVote<'info> {
    #[account(
        mut,
        seeds = [b"proposal", proposal.company.as_ref(), proposal.proposal_id.as_ref()],
        bump = proposal.bump,
    )]
    pub proposal: Account<'info, Proposal>,
    #[account(
        init,
        payer = voter,
        space = 8 + VoteRecord::INIT_SPACE,
        seeds = [b"vote", proposal.company.as_ref(), proposal.proposal_id.as_ref(), voter.key().as_ref()],
        bump,
    )]
    pub vote: Account<'info, VoteRecord>,
    #[account(mut)]
    pub voter: Signer<'info>,
    pub system_program: Program<'info, System>,
}

// -----------------------------------------------------------------------------
// Events
// -----------------------------------------------------------------------------

#[event]
pub struct ConfigRegistered {
    pub company: Pubkey,
    pub governance_config_id: [u8; 32],
    pub quorum_bps: u16,
    pub support_bps: u16,
}

#[event]
pub struct ProposalCreated {
    pub company: Pubkey,
    pub proposal_id: [u8; 32],
    pub governance_config_id: [u8; 32],
    pub proposer: Pubkey,
    pub vote_start: i64,
    pub vote_duration: i64,
}

#[event]
pub struct ProposalExecuted {
    pub company: Pubkey,
    pub proposal_id: [u8; 32],
    pub for_votes: u128,
    pub against_votes: u128,
    pub abstain_votes: u128,
    pub executed_at: i64,
}

#[event]
pub struct VoteCast {
    pub company: Pubkey,
    pub proposal_id: [u8; 32],
    pub voter: Pubkey,
    pub choice: u8,
    pub weight: u128,
}

#[event]
pub struct SnapshotRootCommitted {
    pub company: Pubkey,
    pub proposal_id: [u8; 32],
    pub snapshot_slot: u64,
    pub snapshot_root: [u8; 32],
    pub total_supply_snapshot: u64,
}

#[error_code]
pub enum GovernanceError {
    #[msg("bps value must be between 1 and 10000 (0.01%–100.00%)")]
    InvalidBpsValue,
    #[msg("voting_period must be > 0")]
    ZeroVotingPeriod,
    #[msg("governance_config_id mismatch — config PDA doesn't match the id passed")]
    ConfigMismatch,
    #[msg("vote choice must be 0 (against), 1 (for), or 2 (abstain)")]
    InvalidVoteChoice,
    #[msg("vote weight must be > 0")]
    ZeroWeight,
    #[msg("generic caller-supplied vote weights are disabled; use token or role voting")]
    GenericVotingDisabled,
    #[msg("proposal has already been executed")]
    ProposalAlreadyExecuted,
    #[msg("proposal was canceled")]
    ProposalCanceled,
    #[msg("voting has not yet started for this proposal")]
    VotingNotStarted,
    #[msg("voting has closed for this proposal")]
    VotingClosed,
    #[msg("voting has not yet closed and config does not allow early enact")]
    VotingNotClosed,
    #[msg("quorum threshold not met")]
    QuorumNotMet,
    #[msg("no decisive votes (for + against = 0)")]
    NoDecisiveVotes,
    #[msg("support threshold not met")]
    SupportNotMet,
    #[msg("execution delay has not yet elapsed")]
    ExecutionDelayNotMet,
    #[msg("voter_checkpoint.account != voter signer")]
    CheckpointVoterMismatch,
    #[msg("voter_checkpoint is not owned by aeqi_role or has invalid layout")]
    InvalidCheckpoint,
    #[msg("voter_checkpoint.slot is newer than proposal.snapshot_slot")]
    CheckpointAfterSnapshot,
    #[msg("execute_proposal requires a canonical vote supply account")]
    MissingVoteSupplyAccount,
    #[msg("vote supply account does not match the proposal voting mode")]
    VoteSupplyAccountMismatch,
    #[msg("vote supply account has invalid owner or layout")]
    InvalidVoteSupplyAccount,
    #[msg("vote supply must be > 0")]
    ZeroVoteSupply,
    #[msg("math overflow")]
    MathOverflow,
    #[msg("caller is not authorized for this company")]
    Unauthorized,
    #[msg("company must be in creation mode to initialize the governance module")]
    CompanyNotInCreationMode,
    #[msg("snapshot_root already committed for this proposal (one-shot)")]
    CommitRootMismatch,
    #[msg("snapshot_root not yet committed — wait for the snapshotter to run")]
    SnapshotNotCommitted,
    #[msg("merkle proof does not verify against proposal.snapshot_root")]
    InvalidMerkleProof,
    #[msg("snapshot_slot not yet finalized — wait for current_slot > snapshot_slot")]
    SnapshotSlotNotYetReached,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn governance_config_data(cfg: &GovernanceConfig) -> Vec<u8> {
        let mut data = Vec::new();
        data.extend_from_slice(GovernanceConfig::DISCRIMINATOR);
        cfg.serialize(&mut data).unwrap();
        data
    }

    fn sample_config(company: Pubkey, governance_config_id: [u8; 32]) -> GovernanceConfig {
        GovernanceConfig {
            company,
            governance_config_id,
            proposal_threshold: 0,
            quorum_bps: 4000,
            support_bps: 5000,
            voting_period: 60,
            execution_delay: 0,
            allow_early_enact: true,
            bump: 255,
        }
    }

    fn assert_config_mismatch(result: Result<GovernanceConfig>) {
        match result {
            Ok(_) => panic!("expected ConfigMismatch"),
            Err(err) => assert!(err.to_string().contains("ConfigMismatch"), "{err}"),
        }
    }

    /// Build a sorted-pair Merkle tree over `leaves` and return
    /// `(root, proofs_in_input_order)`. Mirrors the indexer's snapshot
    /// builder so on-chain `verify_merkle_proof` and the off-chain
    /// snapshotter stay in lockstep — drift here is the most subtle way
    /// to break token voting (proofs look fine, just never validate).
    fn build_merkle_tree(leaves: &[[u8; 32]]) -> ([u8; 32], Vec<Vec<[u8; 32]>>) {
        assert!(!leaves.is_empty());
        // Layer 0 = leaves as given. Each subsequent layer pairs them up
        // (sorted hashing); odd elements promote unchanged.
        let mut layers: Vec<Vec<[u8; 32]>> = vec![leaves.to_vec()];
        while layers.last().unwrap().len() > 1 {
            let prev = layers.last().unwrap();
            let mut next = Vec::with_capacity(prev.len().div_ceil(2));
            for chunk in prev.chunks(2) {
                if chunk.len() == 2 {
                    let (a, b) = (chunk[0], chunk[1]);
                    let parent = if a <= b {
                        hashv(&[&a, &b]).to_bytes()
                    } else {
                        hashv(&[&b, &a]).to_bytes()
                    };
                    next.push(parent);
                } else {
                    next.push(chunk[0]);
                }
            }
            layers.push(next);
        }
        let root = layers.last().unwrap()[0];

        // Build proofs by walking each leaf up the tree.
        let mut proofs = Vec::with_capacity(leaves.len());
        for (leaf_idx, _) in leaves.iter().enumerate() {
            let mut proof = Vec::new();
            let mut idx = leaf_idx;
            for layer in &layers[..layers.len() - 1] {
                let sibling_idx = idx ^ 1;
                if sibling_idx < layer.len() {
                    proof.push(layer[sibling_idx]);
                }
                idx /= 2;
            }
            proofs.push(proof);
        }
        (root, proofs)
    }

    #[test]
    fn token_vote_leaf_is_deterministic_and_separates_by_balance() {
        let voter = Pubkey::new_unique();
        let leaf_100 = token_vote_leaf(&voter, 100);
        let leaf_100_again = token_vote_leaf(&voter, 100);
        let leaf_1000 = token_vote_leaf(&voter, 1000);

        assert_eq!(leaf_100, leaf_100_again, "leaf encoding must be stable");
        assert_ne!(leaf_100, leaf_1000, "different balances must hash to different leaves");
        // Adversarial: a different voter at same balance also gets a
        // different leaf.
        let other_voter = Pubkey::new_unique();
        assert_ne!(token_vote_leaf(&other_voter, 100), leaf_100);
    }

    #[test]
    fn verify_merkle_proof_accepts_valid_inclusion() {
        let voters: Vec<Pubkey> = (0..4).map(|_| Pubkey::new_unique()).collect();
        let leaves: Vec<[u8; 32]> = voters
            .iter()
            .enumerate()
            .map(|(i, v)| token_vote_leaf(v, ((i + 1) * 100) as u64))
            .collect();
        let (root, proofs) = build_merkle_tree(&leaves);
        for (i, leaf) in leaves.iter().enumerate() {
            assert!(verify_merkle_proof(*leaf, &proofs[i], root), "leaf {i} should verify");
        }
    }

    #[test]
    fn verify_merkle_proof_rejects_wrong_balance() {
        let voters: Vec<Pubkey> = (0..3).map(|_| Pubkey::new_unique()).collect();
        let leaves: Vec<[u8; 32]> = voters.iter().map(|v| token_vote_leaf(v, 100)).collect();
        let (root, proofs) = build_merkle_tree(&leaves);

        // Adversary: claim 1000 with voter[0]'s real proof (and pubkey).
        let forged_leaf = token_vote_leaf(&voters[0], 1000);
        assert!(!verify_merkle_proof(forged_leaf, &proofs[0], root));
    }

    #[test]
    fn verify_merkle_proof_rejects_wrong_proof_path() {
        let voters: Vec<Pubkey> = (0..4).map(|_| Pubkey::new_unique()).collect();
        let leaves: Vec<[u8; 32]> = voters.iter().map(|v| token_vote_leaf(v, 100)).collect();
        let (root, proofs) = build_merkle_tree(&leaves);

        // Adversary: voter[0]'s leaf with voter[1]'s proof — same tree
        // but wrong sibling chain.
        assert!(!verify_merkle_proof(leaves[0], &proofs[1], root));
    }

    #[test]
    fn verify_merkle_proof_single_leaf_tree_uses_empty_proof() {
        // 1-voter tree: root == leaf, proof is empty.
        let voter = Pubkey::new_unique();
        let leaf = token_vote_leaf(&voter, 42);
        let (root, proofs) = build_merkle_tree(&[leaf]);
        assert_eq!(root, leaf);
        assert!(proofs[0].is_empty());
        assert!(verify_merkle_proof(leaf, &proofs[0], root));
        // Wrong leaf with empty proof must fail.
        let other = token_vote_leaf(&voter, 43);
        assert!(!verify_merkle_proof(other, &[], root));
    }

    #[test]
    fn checked_bps_ceil_rounds_fractional_thresholds_up() {
        assert_eq!(checked_bps_ceil(1, 5000).unwrap(), 1);
        assert_eq!(checked_bps_ceil(3, 3334).unwrap(), 2);
        assert_eq!(checked_bps_ceil(1_000_000, 4000).unwrap(), 400_000);
    }

    #[test]
    fn load_governance_config_rejects_wrong_discriminator() {
        let company = Pubkey::new_unique();
        let governance_config_id = [7u8; 32];
        let (cfg_key, _) = Pubkey::find_program_address(
            &[b"gov_config", company.as_ref(), governance_config_id.as_ref()],
            &crate::ID,
        );
        let cfg = sample_config(company, governance_config_id);
        let mut data = governance_config_data(&cfg);
        data[0] ^= 0xff;
        let mut lamports = 1;

        let cfg_acct = AccountInfo::new(
            &cfg_key,
            false,
            false,
            &mut lamports,
            &mut data,
            &crate::ID,
            false,
            0,
        );

        assert_config_mismatch(load_governance_config(
            &cfg_acct,
            &company,
            &governance_config_id,
            &crate::ID,
        ));
    }

    #[test]
    fn load_governance_config_rejects_truncated_body() {
        let company = Pubkey::new_unique();
        let governance_config_id = [8u8; 32];
        let (cfg_key, _) = Pubkey::find_program_address(
            &[b"gov_config", company.as_ref(), governance_config_id.as_ref()],
            &crate::ID,
        );
        let mut data = GovernanceConfig::DISCRIMINATOR.to_vec();
        let mut lamports = 1;

        let cfg_acct = AccountInfo::new(
            &cfg_key,
            false,
            false,
            &mut lamports,
            &mut data,
            &crate::ID,
            false,
            0,
        );

        assert_config_mismatch(load_governance_config(
            &cfg_acct,
            &company,
            &governance_config_id,
            &crate::ID,
        ));
    }

    #[test]
    fn load_governance_config_rejects_embedded_company_mismatch() {
        let company = Pubkey::new_unique();
        let governance_config_id = [9u8; 32];
        let (cfg_key, _) = Pubkey::find_program_address(
            &[b"gov_config", company.as_ref(), governance_config_id.as_ref()],
            &crate::ID,
        );
        let cfg = sample_config(Pubkey::new_unique(), governance_config_id);
        let mut data = governance_config_data(&cfg);
        let mut lamports = 1;

        let cfg_acct = AccountInfo::new(
            &cfg_key,
            false,
            false,
            &mut lamports,
            &mut data,
            &crate::ID,
            false,
            0,
        );

        assert_config_mismatch(load_governance_config(
            &cfg_acct,
            &company,
            &governance_config_id,
            &crate::ID,
        ));
    }
}
