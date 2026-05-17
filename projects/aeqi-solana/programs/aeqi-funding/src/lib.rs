//! aeqi_funding — capital raise orchestration.
//!
//! A FundingRequest declares the *intent* to raise capital via one of the
//! three live Unifutures primitives, plus the pool surface as it lands:
//!   - CommitmentSale (fixed-price pre-sale)
//!   - BondingCurve (continuous-curve issuance)
//!   - Exit (pro-rata redemption)
//!   - LiquidityPool (constant-product pool)
//!
//! Lifecycle (implemented incrementally):
//!   1. `create_funding_request` — declares the intent, references a Budget
//!      for the asset allocation
//!   2. `activate` — validates Budget capacity, creates the corresponding
//!      Unifutures primitive (CPIs into aeqi_unifutures)
//!   3. `on_tokens_claimed` — hook fired when Unifutures tokens are claimed,
//!      creates vesting roles for buyers via aeqi_role + aeqi_vesting CPIs
//!      [pending]
//!   4. `finalize` — closes the funding round, returns excess to Budget
//!      [pending]
//!
//! This iteration ships state + create only. The CPI-orchestrated lifecycle
//! follows once the inter-module CPI surfaces stabilize.

// Anchor 0.31 emits external macro warnings under newer Rust check-cfg/deprecation
// lints. Keep this crate's warning output focused on protocol code.
#![allow(deprecated, unexpected_cfgs)]

use aeqi_budget::Budget;
use aeqi_trust::state::Trust;
use aeqi_unifutures::cpi::accounts::{CreateCommitmentSale, CreateCurve, CreateExit};
use aeqi_unifutures::program::AeqiUnifutures;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

declare_id!("8dCM5qRnfMAZGdsC8pYYQzomVdQpihL9jgwAXoPaie3U");

/// aeqi_trust program id — used for cross-program PDA derivation so module
/// setup paths cannot accept arbitrary trust pubkeys.
pub const AEQI_TRUST_ID: Pubkey =
    anchor_lang::pubkey!("CCbs4TCqE6FXmRdyLexx2rSSHAShymWrrR9QWeJUJbXV");

#[program]
pub mod aeqi_funding {
    use super::*;

    /// Module init — gated to the trust authority during creation mode so
    /// the module_state PDA cannot be squatted by an attacker.
    pub fn init(ctx: Context<InitFunding>) -> Result<()> {
        let trust = &ctx.accounts.trust;
        require!(trust.creation_mode, FundingError::TrustNotInCreationMode);
        require_keys_eq!(ctx.accounts.payer.key(), trust.authority, FundingError::Unauthorized);

        let m = &mut ctx.accounts.module_state;
        m.trust = ctx.accounts.trust.key();
        m.request_count = 0;
        m.bump = ctx.bumps.module_state;
        Ok(())
    }

    /// Declare a funding request. Records the intent without activating.
    /// `kind` is 0 (CommitmentSale), 1 (BondingCurve), or 2 (Exit).
    pub fn create_funding_request(
        ctx: Context<CreateFundingRequest>,
        request_id: [u8; 32],
        kind: u8,
        budget_id: [u8; 32],
        asset_amount: u64,
        target_quote: u64,
    ) -> Result<()> {
        require!(kind <= 2, FundingError::InvalidKind);
        // CommitmentSale needs concrete amounts at request time; BondingCurve
        // and Exit carry their parameters in the activation call (curve /
        // exit parameters are kind-specific and meaningless here), so the
        // zero gate is kind=0 only.
        if kind == 0 {
            require!(asset_amount > 0, FundingError::ZeroAmount);
            require!(target_quote > 0, FundingError::ZeroAmount);
        }
        require_budget_capacity(
            &ctx.accounts.budget,
            ctx.accounts.trust.key(),
            budget_id,
            if kind == 0 { asset_amount } else { 0 },
        )?;

        let now = Clock::get()?.unix_timestamp;
        let r = &mut ctx.accounts.request;
        r.trust = ctx.accounts.trust.key();
        r.request_id = request_id;
        r.creator = ctx.accounts.creator.key();
        r.kind = kind;
        r.budget_id = budget_id;
        r.asset_amount = asset_amount;
        r.target_quote = target_quote;
        r.status = RequestStatus::Pending as u8;
        r.created_at = now;
        r.primitive_id = [0u8; 32]; // set on activation
        r.bump = ctx.bumps.request;

        let m = &mut ctx.accounts.module_state;
        m.request_count =
            m.request_count.checked_add(1).ok_or(error!(FundingError::MathOverflow))?;

        emit!(FundingRequestCreated {
            trust: r.trust,
            request_id,
            creator: r.creator,
            kind,
            budget_id,
            asset_amount,
            target_quote,
        });
        Ok(())
    }

    /// Activate a CommitmentSale-kind funding request — CPIs into
    /// `aeqi_unifutures::create_commitment_sale` with the request's params.
    /// Sets status = Activated, primitive_id = the new sale's id.
    /// (BondingCurve + Exit activation follow the same shape; this iteration
    /// covers kind=0 only.)
    pub fn activate_commitment_sale<'info>(
        ctx: Context<'_, '_, 'info, 'info, ActivateCommitmentSale<'info>>,
        sale_id: [u8; 32],
        overflow_quote: u64,
        duration_secs: i64,
    ) -> Result<()> {
        let r = &mut ctx.accounts.request;
        require_keys_eq!(ctx.accounts.creator.key(), r.creator, FundingError::Unauthorized);
        require_keys_eq!(ctx.accounts.trust.key(), r.trust, FundingError::TrustMismatch);
        require_budget_capacity(&ctx.accounts.budget, r.trust, r.budget_id, r.asset_amount)?;
        require!(r.status == RequestStatus::Pending as u8, FundingError::CannotActivate);
        require!(r.kind == 0, FundingError::WrongKind);

        let cpi = CreateCommitmentSale {
            trust: ctx.accounts.trust.to_account_info(),
            module_state: ctx.accounts.unifutures_module_state.to_account_info(),
            sale: ctx.accounts.sale.to_account_info(),
            creator: ctx.accounts.creator.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
        };
        aeqi_unifutures::cpi::create_commitment_sale(
            CpiContext::new(ctx.accounts.aeqi_unifutures_program.to_account_info(), cpi),
            sale_id,
            r.asset_amount,
            r.target_quote,
            overflow_quote,
            duration_secs,
        )?;

        r.status = RequestStatus::Activated as u8;
        r.primitive_id = sale_id;

        emit!(FundingRequestActivated {
            trust: r.trust,
            request_id: r.request_id,
            kind: r.kind,
            primitive_id: sale_id,
        });
        Ok(())
    }

    /// Activate a BondingCurve-kind funding request — CPIs into
    /// `aeqi_unifutures::create_curve`.
    pub fn activate_bonding_curve<'info>(
        ctx: Context<'_, '_, 'info, 'info, ActivateBondingCurve<'info>>,
        curve_id: [u8; 32],
        curve_type: u8,
        start_price: u128,
        end_price: u128,
        max_supply: u64,
        reserve_ratio_ppm: u32,
    ) -> Result<()> {
        let r = &mut ctx.accounts.request;
        require_keys_eq!(ctx.accounts.creator.key(), r.creator, FundingError::Unauthorized);
        require_keys_eq!(ctx.accounts.trust.key(), r.trust, FundingError::TrustMismatch);
        require_budget_capacity(&ctx.accounts.budget, r.trust, r.budget_id, max_supply)?;
        require!(r.status == RequestStatus::Pending as u8, FundingError::CannotActivate);
        require!(r.kind == 1, FundingError::WrongKind);

        let cpi = CreateCurve {
            trust: ctx.accounts.trust.to_account_info(),
            module_state: ctx.accounts.unifutures_module_state.to_account_info(),
            curve: ctx.accounts.curve.to_account_info(),
            asset_mint: ctx.accounts.asset_mint.to_account_info(),
            quote_mint: ctx.accounts.quote_mint.to_account_info(),
            creator: ctx.accounts.creator.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
        };
        aeqi_unifutures::cpi::create_curve(
            CpiContext::new(ctx.accounts.aeqi_unifutures_program.to_account_info(), cpi),
            curve_id,
            curve_type,
            start_price,
            end_price,
            max_supply,
            reserve_ratio_ppm,
        )?;

        r.status = RequestStatus::Activated as u8;
        r.primitive_id = curve_id;

        emit!(FundingRequestActivated {
            trust: r.trust,
            request_id: r.request_id,
            kind: r.kind,
            primitive_id: curve_id,
        });
        Ok(())
    }

    /// Activate an Exit-kind funding request — CPIs into
    /// `aeqi_unifutures::create_exit`.
    pub fn activate_exit<'info>(
        ctx: Context<'_, '_, 'info, 'info, ActivateExit<'info>>,
        exit_id: [u8; 32],
        exit_quote: u64,
        total_supply_snapshot: u64,
        duration_secs: i64,
    ) -> Result<()> {
        let r = &mut ctx.accounts.request;
        require_keys_eq!(ctx.accounts.creator.key(), r.creator, FundingError::Unauthorized);
        require_keys_eq!(ctx.accounts.trust.key(), r.trust, FundingError::TrustMismatch);
        require_budget_capacity(&ctx.accounts.budget, r.trust, r.budget_id, exit_quote)?;
        require!(r.status == RequestStatus::Pending as u8, FundingError::CannotActivate);
        require!(r.kind == 2, FundingError::WrongKind);

        let cpi = CreateExit {
            trust: ctx.accounts.trust.to_account_info(),
            module_state: ctx.accounts.unifutures_module_state.to_account_info(),
            exit: ctx.accounts.exit.to_account_info(),
            asset_mint: ctx.accounts.asset_mint.to_account_info(),
            creator: ctx.accounts.creator.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
        };
        aeqi_unifutures::cpi::create_exit(
            CpiContext::new(ctx.accounts.aeqi_unifutures_program.to_account_info(), cpi),
            exit_id,
            exit_quote,
            total_supply_snapshot,
            duration_secs,
        )?;

        r.status = RequestStatus::Activated as u8;
        r.primitive_id = exit_id;

        emit!(FundingRequestActivated {
            trust: r.trust,
            request_id: r.request_id,
            kind: r.kind,
            primitive_id: exit_id,
        });
        Ok(())
    }

    /// Finalize an Activated funding request — closes the lifecycle once
    /// the underlying Unifutures primitive has settled. Caller is the
    /// creator (they own request lifecycle), and finalize is permanent;
    /// downstream excess-budget refund / vesting role hooks will read
    /// `status == Finalized` as their gate.
    pub fn finalize_funding_request(ctx: Context<FinalizeFundingRequest>) -> Result<()> {
        let r = &mut ctx.accounts.request;
        require_keys_eq!(ctx.accounts.creator.key(), r.creator, FundingError::Unauthorized);
        require!(r.status == RequestStatus::Activated as u8, FundingError::CannotFinalize);
        r.status = RequestStatus::Finalized as u8;
        emit!(FundingRequestFinalized {
            trust: r.trust,
            request_id: r.request_id,
            kind: r.kind,
            primitive_id: r.primitive_id,
        });
        Ok(())
    }

    /// Cancel a pending funding request. Only the creator can cancel.
    pub fn cancel_funding_request(ctx: Context<CancelFundingRequest>) -> Result<()> {
        let r = &mut ctx.accounts.request;
        require_keys_eq!(ctx.accounts.creator.key(), r.creator, FundingError::Unauthorized);
        require!(r.status == RequestStatus::Pending as u8, FundingError::CannotCancel);
        r.status = RequestStatus::Cancelled as u8;
        emit!(FundingRequestCancelled { trust: r.trust, request_id: r.request_id });
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct FundingModuleState {
    pub trust: Pubkey,
    pub request_count: u64,
    pub bump: u8,
}

#[repr(u8)]
pub enum RequestStatus {
    Pending = 0,
    Activated = 1,
    Finalized = 2,
    Cancelled = 3,
}

#[account]
#[derive(InitSpace)]
pub struct FundingRequest {
    pub trust: Pubkey,
    pub request_id: [u8; 32],
    pub creator: Pubkey,
    pub kind: u8, // 0=CommitmentSale 1=BondingCurve 2=Exit
    pub budget_id: [u8; 32],
    pub asset_amount: u64,
    pub target_quote: u64,
    pub status: u8,
    pub created_at: i64,
    /// Set on activation to the underlying Unifutures primitive's id
    /// (sale_id / curve_id / exit_id depending on kind).
    pub primitive_id: [u8; 32],
    pub bump: u8,
}

fn require_budget_capacity(
    budget: &Budget,
    trust: Pubkey,
    budget_id: [u8; 32],
    required_amount: u64,
) -> Result<()> {
    require_keys_eq!(budget.trust, trust, FundingError::BudgetMismatch);
    require!(budget.budget_id == budget_id, FundingError::BudgetMismatch);
    require!(!budget.frozen, FundingError::BudgetUnavailable);
    if budget.expiry != 0 {
        let now = Clock::get()?.unix_timestamp;
        require!(now < budget.expiry, FundingError::BudgetUnavailable);
    }
    if required_amount > 0 {
        let remaining =
            budget.amount.checked_sub(budget.spent).ok_or(error!(FundingError::MathOverflow))?;
        require!(remaining >= required_amount, FundingError::BudgetCapacityExceeded);
    }
    Ok(())
}

#[derive(Accounts)]
pub struct InitFunding<'info> {
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
        space = 8 + FundingModuleState::INIT_SPACE,
        seeds = [b"funding_module", trust.key().as_ref()],
        bump,
    )]
    pub module_state: Account<'info, FundingModuleState>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(request_id: [u8; 32])]
pub struct CreateFundingRequest<'info> {
    /// CHECK: trust pda
    pub trust: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"funding_module", trust.key().as_ref()],
        bump = module_state.bump,
    )]
    pub module_state: Account<'info, FundingModuleState>,
    #[account(
        init,
        payer = creator,
        space = 8 + FundingRequest::INIT_SPACE,
        seeds = [b"funding_request", trust.key().as_ref(), request_id.as_ref()],
        bump,
    )]
    pub request: Account<'info, FundingRequest>,
    pub budget: Account<'info, Budget>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ActivateCommitmentSale<'info> {
    #[account(
        mut,
        seeds = [b"funding_request", request.trust.as_ref(), request.request_id.as_ref()],
        bump = request.bump,
    )]
    pub request: Account<'info, FundingRequest>,
    pub budget: Account<'info, Budget>,
    /// CHECK: trust pda — passed through to aeqi_unifutures CPI
    pub trust: UncheckedAccount<'info>,
    /// CHECK: aeqi_unifutures' module_state PDA — validated by the CPI
    #[account(mut)]
    pub unifutures_module_state: UncheckedAccount<'info>,
    /// CHECK: aeqi_unifutures will init the CommitmentSale PDA
    #[account(mut)]
    pub sale: UncheckedAccount<'info>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub aeqi_unifutures_program: Program<'info, AeqiUnifutures>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ActivateBondingCurve<'info> {
    #[account(
        mut,
        seeds = [b"funding_request", request.trust.as_ref(), request.request_id.as_ref()],
        bump = request.bump,
    )]
    pub request: Account<'info, FundingRequest>,
    pub budget: Account<'info, Budget>,
    /// CHECK: trust pda
    pub trust: UncheckedAccount<'info>,
    /// CHECK: unifutures module_state
    #[account(mut)]
    pub unifutures_module_state: UncheckedAccount<'info>,
    /// CHECK: aeqi_unifutures inits the BondingCurve PDA
    #[account(mut)]
    pub curve: UncheckedAccount<'info>,
    pub asset_mint: InterfaceAccount<'info, Mint>,
    pub quote_mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub aeqi_unifutures_program: Program<'info, AeqiUnifutures>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ActivateExit<'info> {
    #[account(
        mut,
        seeds = [b"funding_request", request.trust.as_ref(), request.request_id.as_ref()],
        bump = request.bump,
    )]
    pub request: Account<'info, FundingRequest>,
    pub budget: Account<'info, Budget>,
    /// CHECK: trust pda
    pub trust: UncheckedAccount<'info>,
    /// CHECK: unifutures module_state
    #[account(mut)]
    pub unifutures_module_state: UncheckedAccount<'info>,
    /// CHECK: aeqi_unifutures inits the Exit PDA
    #[account(mut)]
    pub exit: UncheckedAccount<'info>,
    /// CHECK: passed through to aeqi_unifutures::create_exit, which
    /// deserializes it as a Mint and pins it onto the Exit account.
    pub asset_mint: UncheckedAccount<'info>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub aeqi_unifutures_program: Program<'info, AeqiUnifutures>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelFundingRequest<'info> {
    #[account(
        mut,
        seeds = [b"funding_request", request.trust.as_ref(), request.request_id.as_ref()],
        bump = request.bump,
    )]
    pub request: Account<'info, FundingRequest>,
    pub creator: Signer<'info>,
}

#[derive(Accounts)]
pub struct FinalizeFundingRequest<'info> {
    #[account(
        mut,
        seeds = [b"funding_request", request.trust.as_ref(), request.request_id.as_ref()],
        bump = request.bump,
    )]
    pub request: Account<'info, FundingRequest>,
    pub creator: Signer<'info>,
}

#[event]
pub struct FundingRequestCreated {
    pub trust: Pubkey,
    pub request_id: [u8; 32],
    pub creator: Pubkey,
    pub kind: u8,
    pub budget_id: [u8; 32],
    pub asset_amount: u64,
    pub target_quote: u64,
}

#[event]
pub struct FundingRequestCancelled {
    pub trust: Pubkey,
    pub request_id: [u8; 32],
}

#[event]
pub struct FundingRequestActivated {
    pub trust: Pubkey,
    pub request_id: [u8; 32],
    pub kind: u8,
    pub primitive_id: [u8; 32],
}

#[event]
pub struct FundingRequestFinalized {
    pub trust: Pubkey,
    pub request_id: [u8; 32],
    pub kind: u8,
    pub primitive_id: [u8; 32],
}

#[error_code]
pub enum FundingError {
    #[msg("kind must be 0 (CommitmentSale), 1 (BondingCurve), or 2 (Exit)")]
    InvalidKind,
    #[msg("amount must be > 0")]
    ZeroAmount,
    #[msg("math overflow")]
    MathOverflow,
    #[msg("only creator can cancel a request")]
    Unauthorized,
    #[msg("trust account does not match the funding request")]
    TrustMismatch,
    #[msg("request is not in Pending status — can't cancel")]
    CannotCancel,
    #[msg("request is not in Pending status — can't activate")]
    CannotActivate,
    #[msg("request is not in Activated status — can't finalize")]
    CannotFinalize,
    #[msg("request kind doesn't match this activation ix (kind=0 for CommitmentSale)")]
    WrongKind,
    #[msg("budget account does not match the funding request")]
    BudgetMismatch,
    #[msg("budget is frozen or expired")]
    BudgetUnavailable,
    #[msg("budget has insufficient remaining allocation")]
    BudgetCapacityExceeded,
    #[msg("trust must be in creation mode to initialize the funding module")]
    TrustNotInCreationMode,
}
