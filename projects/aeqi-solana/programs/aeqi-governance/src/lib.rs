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

use aeqi_trust::state::Trust;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::spl_token_2022::{
    extension::StateWithExtensions, state::Mint as SplMint,
};
use anchor_spl::token_interface::{Mint, TokenAccount};

declare_id!("5WHpPFf2mPYNFjr5p3ujeRcZNPoqWMBMkYnsWb2YtyNq");

/// aeqi_trust program id — used for cross-program PDA derivation so module
/// setup paths (init, register_config) cannot accept arbitrary trust pubkeys.
pub const AEQI_TRUST_ID: Pubkey =
    anchor_lang::pubkey!("CCbs4TCqE6FXmRdyLexx2rSSHAShymWrrR9QWeJUJbXV");

/// Hardcoded aeqi_role program ID — used to validate the PDA derivation +
/// account ownership of `voter_checkpoint` in `cast_vote_role`. Avoids a
/// cross-crate dep just to read RoleVoteCheckpoint.account / .count.
pub const AEQI_ROLE_ID: Pubkey =
    anchor_lang::pubkey!("4GSrvANBi1yrn3w4VgoxvVz7pH9BdR8MeyUpH4ZcGXpB");

/// Hardcoded aeqi_token program ID — used to validate the cap-table mint
/// passed to `cast_vote_token` is the canonical PDA `[b"mint", trust]`
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
    pub trust: Pubkey,
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

    /// Module init — creates GovernanceModuleState PDA bound to a trust.
    /// Gated to the trust authority during creation mode so the
    /// module_state PDA cannot be squatted by an attacker.
    pub fn init(ctx: Context<InitGovernance>) -> Result<()> {
        let trust = &ctx.accounts.trust;
        require!(trust.creation_mode, GovernanceError::TrustNotInCreationMode);
        require_keys_eq!(ctx.accounts.payer.key(), trust.authority, GovernanceError::Unauthorized);

        let m = &mut ctx.accounts.module_state;
        m.trust = ctx.accounts.trust.key();
        m.proposal_count = 0;
        m.config_count = 0;
        m.bump = ctx.bumps.module_state;
        Ok(())
    }

    pub fn finalize(_ctx: Context<FinalizeGovernance>) -> Result<()> {
        Ok(())
    }

    /// Register a governance config (one per voting mode the trust supports).
    /// Authority gate: only the trust authority can register configs in this
    /// iteration. Once live-mode governance lands, ratified config changes
    /// will flow through `execute_proposal`.
    pub fn register_config(
        ctx: Context<RegisterConfig>,
        governance_config_id: [u8; 32],
        config: GovernanceConfigInput,
    ) -> Result<()> {
        let trust = &ctx.accounts.trust;
        require_keys_eq!(ctx.accounts.payer.key(), trust.authority, GovernanceError::Unauthorized);

        require!(config.quorum_bps <= 10_000, GovernanceError::InvalidBpsValue);
        require!(config.support_bps <= 10_000, GovernanceError::InvalidBpsValue);
        require!(config.quorum_bps > 0, GovernanceError::InvalidBpsValue);
        require!(config.support_bps > 0, GovernanceError::InvalidBpsValue);
        require!(config.voting_period > 0, GovernanceError::ZeroVotingPeriod);

        let g = &mut ctx.accounts.governance_config;
        g.trust = ctx.accounts.trust.key();
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
            trust: g.trust,
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
            load_governance_config(cfg_acct, &p.trust, &p.governance_config_id, ctx.program_id)?;
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
            trust: p.trust,
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

    /// Cast a token-weighted vote. Vote power = `voter_token_account.amount`,
    /// validated to be owned by the voter. The caller MUST pass the trust's
    /// canonical Token-2022 cap-table account; mint validation against the
    /// `[b"mint", trust]` PDA keeps the voting source canonical.
    pub fn cast_vote_token(ctx: Context<CastVoteToken>, choice: u8) -> Result<()> {
        let weight = ctx.accounts.voter_token_account.amount as u128;
        require!(weight > 0, GovernanceError::ZeroWeight);

        let p = &mut ctx.accounts.proposal;
        let now = Clock::get()?.unix_timestamp;
        require_vote_open(p, now)?;

        apply_vote_tally(p, choice, weight)?;
        let v = &mut ctx.accounts.vote;
        record_vote(v, p, ctx.accounts.voter.key(), choice, weight, ctx.bumps.vote);
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
            &ctx.accounts.trust.key(),
            &governance_config_id,
            ctx.program_id,
        )?;

        let now = Clock::get()?.unix_timestamp;
        let p = &mut ctx.accounts.proposal;
        p.trust = ctx.accounts.trust.key();
        p.proposal_id = proposal_id;
        p.governance_config_id = governance_config_id;
        p.proposer = ctx.accounts.proposer.key();
        p.ipfs_cid = ipfs_cid;
        p.vote_start = now;
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
            trust: p.trust,
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
        Pubkey::find_program_address(&[b"mint", proposal.trust.as_ref()], &AEQI_TOKEN_ID);
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
        &[b"role_type", proposal.trust.as_ref(), proposal.governance_config_id.as_ref()],
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
    require_keys_eq!(role_type.trust, proposal.trust, GovernanceError::VoteSupplyAccountMismatch);
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
    vote.trust = proposal.trust;
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

fn bump_config_count(module_state: &mut Account<GovernanceModuleState>) -> Result<()> {
    module_state.config_count =
        module_state.config_count.checked_add(1).ok_or(error!(GovernanceError::MathOverflow))?;
    Ok(())
}

fn load_governance_config(
    cfg_acct: &AccountInfo,
    trust: &Pubkey,
    governance_config_id: &[u8; 32],
    program_id: &Pubkey,
) -> Result<GovernanceConfig> {
    let (expected_cfg, _) = Pubkey::find_program_address(
        &[b"gov_config", trust.as_ref(), governance_config_id],
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
    require_keys_eq!(cfg.trust, *trust, GovernanceError::ConfigMismatch);
    require!(cfg.governance_config_id == *governance_config_id, GovernanceError::ConfigMismatch);
    Ok(cfg)
}

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct GovernanceModuleState {
    pub trust: Pubkey,
    pub proposal_count: u64,
    pub config_count: u32,
    pub bump: u8,
}

/// One per voting mode.
#[account]
#[derive(InitSpace)]
pub struct GovernanceConfig {
    pub trust: Pubkey,
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
    pub trust: Pubkey,
    pub proposal_id: [u8; 32],
    pub voter: Pubkey,
    pub choice: u8, // 0 = against, 1 = for, 2 = abstain
    pub weight: u128,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Proposal {
    pub trust: Pubkey,
    pub proposal_id: [u8; 32],
    pub governance_config_id: [u8; 32],
    pub proposer: Pubkey,
    pub ipfs_cid: [u8; 64],
    pub vote_start: i64,
    pub vote_duration: i64,
    pub execution_delay: i64,
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
    /// Trust PDA — must be a real Trust account owned by aeqi_trust.
    #[account(
        seeds = [b"trust", trust.trust_id.as_ref()],
        bump = trust.bump,
        seeds::program = AEQI_TRUST_ID,
    )]
    pub trust: Account<'info, Trust>,
    #[account(
        init,
        payer = payer,
        space = 8 + GovernanceModuleState::INIT_SPACE,
        seeds = [b"gov_module", trust.key().as_ref()],
        bump,
    )]
    pub module_state: Account<'info, GovernanceModuleState>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FinalizeGovernance<'info> {
    /// CHECK: trust pda
    pub trust: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(governance_config_id: [u8; 32])]
pub struct RegisterConfig<'info> {
    /// Trust PDA — must be a real Trust account owned by aeqi_trust.
    #[account(
        seeds = [b"trust", trust.trust_id.as_ref()],
        bump = trust.bump,
        seeds::program = AEQI_TRUST_ID,
    )]
    pub trust: Account<'info, Trust>,
    #[account(
        mut,
        seeds = [b"gov_module", trust.key().as_ref()],
        bump = module_state.bump,
    )]
    pub module_state: Account<'info, GovernanceModuleState>,
    #[account(
        init,
        payer = payer,
        space = 8 + GovernanceConfig::INIT_SPACE,
        seeds = [b"gov_config", trust.key().as_ref(), governance_config_id.as_ref()],
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
    /// CHECK: trust pda
    pub trust: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"gov_module", trust.key().as_ref()],
        bump = module_state.bump,
    )]
    pub module_state: Account<'info, GovernanceModuleState>,
    #[account(
        init,
        payer = proposer,
        space = 8 + Proposal::INIT_SPACE,
        seeds = [b"proposal", trust.key().as_ref(), proposal_id.as_ref()],
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
        seeds = [b"proposal", proposal.trust.as_ref(), proposal.proposal_id.as_ref()],
        bump = proposal.bump,
    )]
    pub proposal: Account<'info, Proposal>,
    pub executor: Signer<'info>,
}

#[derive(Accounts)]
pub struct CastVoteRole<'info> {
    #[account(
        mut,
        seeds = [b"proposal", proposal.trust.as_ref(), proposal.proposal_id.as_ref()],
        bump = proposal.bump,
    )]
    pub proposal: Account<'info, Proposal>,
    #[account(
        init,
        payer = voter,
        space = 8 + VoteRecord::INIT_SPACE,
        seeds = [b"vote", proposal.trust.as_ref(), proposal.proposal_id.as_ref(), voter.key().as_ref()],
        bump,
    )]
    pub vote: Account<'info, VoteRecord>,
    /// CHECK: voter's role-vote checkpoint PDA, owned by aeqi_role. PDA
    /// derivation is enforced by `seeds::program = AEQI_ROLE_ID`; the
    /// handler verifies ownership and borsh-decodes the data manually.
    #[account(
        seeds = [
            b"role_ckpt",
            proposal.trust.as_ref(),
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
        seeds = [b"proposal", proposal.trust.as_ref(), proposal.proposal_id.as_ref()],
        bump = proposal.bump,
    )]
    pub proposal: Account<'info, Proposal>,
    #[account(
        init,
        payer = voter,
        space = 8 + VoteRecord::INIT_SPACE,
        seeds = [b"vote", proposal.trust.as_ref(), proposal.proposal_id.as_ref(), voter.key().as_ref()],
        bump,
    )]
    pub vote: Account<'info, VoteRecord>,
    /// The voter's cap-table token account. `token::authority` constraint
    /// enforces voter owns it; `token::mint = mint` binds it to the
    /// canonical mint PDA below.
    #[account(token::authority = voter, token::mint = mint)]
    pub voter_token_account: InterfaceAccount<'info, TokenAccount>,
    /// The canonical cap-table mint — must be the PDA `[b"mint", trust]`
    /// under aeqi_token. Validated by `seeds::program = AEQI_TOKEN_ID`
    /// so callers can't substitute an unrelated mint.
    #[account(
        seeds = [b"mint", proposal.trust.as_ref()],
        bump,
        seeds::program = AEQI_TOKEN_ID,
    )]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub voter: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CastVote<'info> {
    #[account(
        mut,
        seeds = [b"proposal", proposal.trust.as_ref(), proposal.proposal_id.as_ref()],
        bump = proposal.bump,
    )]
    pub proposal: Account<'info, Proposal>,
    #[account(
        init,
        payer = voter,
        space = 8 + VoteRecord::INIT_SPACE,
        seeds = [b"vote", proposal.trust.as_ref(), proposal.proposal_id.as_ref(), voter.key().as_ref()],
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
    pub trust: Pubkey,
    pub governance_config_id: [u8; 32],
    pub quorum_bps: u16,
    pub support_bps: u16,
}

#[event]
pub struct ProposalCreated {
    pub trust: Pubkey,
    pub proposal_id: [u8; 32],
    pub governance_config_id: [u8; 32],
    pub proposer: Pubkey,
    pub vote_start: i64,
    pub vote_duration: i64,
}

#[event]
pub struct ProposalExecuted {
    pub trust: Pubkey,
    pub proposal_id: [u8; 32],
    pub for_votes: u128,
    pub against_votes: u128,
    pub abstain_votes: u128,
    pub executed_at: i64,
}

#[event]
pub struct VoteCast {
    pub trust: Pubkey,
    pub proposal_id: [u8; 32],
    pub voter: Pubkey,
    pub choice: u8,
    pub weight: u128,
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
    #[msg("caller is not authorized for this trust")]
    Unauthorized,
    #[msg("trust must be in creation mode to initialize the governance module")]
    TrustNotInCreationMode,
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

    fn sample_config(trust: Pubkey, governance_config_id: [u8; 32]) -> GovernanceConfig {
        GovernanceConfig {
            trust,
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

    #[test]
    fn checked_bps_ceil_rounds_fractional_thresholds_up() {
        assert_eq!(checked_bps_ceil(1, 5000).unwrap(), 1);
        assert_eq!(checked_bps_ceil(3, 3334).unwrap(), 2);
        assert_eq!(checked_bps_ceil(1_000_000, 4000).unwrap(), 400_000);
    }

    #[test]
    fn load_governance_config_rejects_wrong_discriminator() {
        let trust = Pubkey::new_unique();
        let governance_config_id = [7u8; 32];
        let (cfg_key, _) = Pubkey::find_program_address(
            &[b"gov_config", trust.as_ref(), governance_config_id.as_ref()],
            &crate::ID,
        );
        let cfg = sample_config(trust, governance_config_id);
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
            &trust,
            &governance_config_id,
            &crate::ID,
        ));
    }

    #[test]
    fn load_governance_config_rejects_truncated_body() {
        let trust = Pubkey::new_unique();
        let governance_config_id = [8u8; 32];
        let (cfg_key, _) = Pubkey::find_program_address(
            &[b"gov_config", trust.as_ref(), governance_config_id.as_ref()],
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
            &trust,
            &governance_config_id,
            &crate::ID,
        ));
    }

    #[test]
    fn load_governance_config_rejects_embedded_trust_mismatch() {
        let trust = Pubkey::new_unique();
        let governance_config_id = [9u8; 32];
        let (cfg_key, _) = Pubkey::find_program_address(
            &[b"gov_config", trust.as_ref(), governance_config_id.as_ref()],
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
            &trust,
            &governance_config_id,
            &crate::ID,
        ));
    }
}
