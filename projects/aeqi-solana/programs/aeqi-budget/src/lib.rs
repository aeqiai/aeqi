//! aeqi_budget — role-bound treasury allocations + spend tracking.
//!
//! Each budget allocates an `amount` to a
//! `target_role_id`; spends decrement the budget's `spent` counter against
//! the cap. Budgets can be frozen/unfrozen by their grantor, and have an
//! optional expiry. Authorization to spend is gated by an occupied
//! `aeqi_role::Role` account for the budget's target role.
//!
//! Settlement of actual funds is delegated: a Budget records the *intent*
//! to spend; the corresponding token transfer happens via `aeqi_treasury`
//! or another module that respects the budget's allocation as a quota.

// Anchor 0.31 emits external macro warnings under newer Rust check-cfg/deprecation
// lints. Keep this crate's warning output focused on protocol code.
#![allow(deprecated, unexpected_cfgs)]

use aeqi_role::{Role, RoleStatus};
use aeqi_company::state::Company;
use anchor_lang::prelude::*;

declare_id!("5PbDxvaYD9shSGxE2pQyUTqCqe6FXUMDciXSEGevFE5G");

/// aeqi_company program id — used for cross-program PDA derivation so module
/// setup paths cannot accept arbitrary company pubkeys.
pub const AEQI_COMPANY_ID: Pubkey =
    anchor_lang::pubkey!("CCbs4TCqE6FXmRdyLexx2rSSHAShymWrrR9QWeJUJbXV");

#[program]
pub mod aeqi_budget {
    use super::*;

    /// Module init — gated to the company authority during creation mode so
    /// the module_state PDA cannot be squatted by an attacker.
    pub fn init(ctx: Context<InitBudget>) -> Result<()> {
        let company = &ctx.accounts.company;
        require!(company.creation_mode, BudgetError::CompanyNotInCreationMode);
        require_keys_eq!(ctx.accounts.payer.key(), company.authority, BudgetError::Unauthorized);

        let m = &mut ctx.accounts.module_state;
        m.company = ctx.accounts.company.key();
        m.budget_count = 0;
        m.bump = ctx.bumps.module_state;
        Ok(())
    }

    /// Create a budget allocation for a role. The grantor (typically a
    /// treasury authority or governance signer) signs to lock the
    /// allocation. A budget can be sourced from COMPANY (no parent) or from
    /// a parent budget (which the grantor must control).
    ///
    /// Authority gate: in this iteration, only the company authority can
    /// originate budgets (i.e. budgets sourced directly from COMPANY). Once
    /// governance + role-walk capability lands, child budgets sourced from
    /// a parent budget will be gated on the parent budget's grantor / role
    /// instead.
    pub fn create_budget(
        ctx: Context<CreateBudget>,
        budget_id: [u8; 32],
        target_role_id: [u8; 32],
        amount: u64,
        expiry: i64,
        parent_budget_id: Option<[u8; 32]>,
    ) -> Result<()> {
        require!(amount > 0, BudgetError::ZeroAmount);
        let now = Clock::get()?.unix_timestamp;
        require!(expiry == 0 || expiry > now, BudgetError::InvalidExpiry);

        // Module-setup authority: budgets sourced from COMPANY require the
        // company authority to sign. Parent-budget-sourced delegation is
        // out of scope until the role-walk + governance plumbing lands.
        let company = &ctx.accounts.company;
        require_keys_eq!(ctx.accounts.grantor.key(), company.authority, BudgetError::Unauthorized);

        let b = &mut ctx.accounts.budget;
        b.company = ctx.accounts.company.key();
        b.budget_id = budget_id;
        b.grantor = ctx.accounts.grantor.key();
        b.target_role_id = target_role_id;
        b.parent_budget_id = parent_budget_id.unwrap_or([0u8; 32]);
        b.amount = amount;
        b.spent = 0;
        b.expiry = expiry;
        b.frozen = false;
        b.bump = ctx.bumps.budget;

        let m = &mut ctx.accounts.module_state;
        m.budget_count = m.budget_count.checked_add(1).ok_or(error!(BudgetError::MathOverflow))?;

        emit!(BudgetCreated {
            company: b.company,
            budget_id,
            grantor: b.grantor,
            target_role_id,
            amount,
            expiry,
        });
        Ok(())
    }

    /// Record a spend against the budget. Caller must hold the occupied
    /// target role referenced by the budget, and budget enforces the cap,
    /// expiry, and frozen flag.
    pub fn record_spend(ctx: Context<RecordSpend>, amount: u64) -> Result<()> {
        require!(amount > 0, BudgetError::ZeroAmount);
        let b = &mut ctx.accounts.budget;
        let spender_role = &ctx.accounts.spender_role;
        require!(spender_role.company == b.company, BudgetError::Unauthorized);
        require!(spender_role.role_id == b.target_role_id, BudgetError::Unauthorized);
        require!(spender_role.status == RoleStatus::Occupied as u8, BudgetError::Unauthorized);
        require_keys_eq!(
            spender_role.account,
            ctx.accounts.spender.key(),
            BudgetError::Unauthorized
        );
        require!(!b.frozen, BudgetError::BudgetFrozen);
        if b.expiry != 0 {
            let now = Clock::get()?.unix_timestamp;
            require!(now < b.expiry, BudgetError::BudgetExpired);
        }
        let new_spent = b.spent.checked_add(amount).ok_or(error!(BudgetError::MathOverflow))?;
        require!(new_spent <= b.amount, BudgetError::ExceedsAllocation);
        b.spent = new_spent;

        emit!(BudgetSpent { company: b.company, budget_id: b.budget_id, amount, total_spent: b.spent });
        Ok(())
    }

    /// Freeze a budget — blocks further spends. Grantor signs.
    pub fn freeze(ctx: Context<Freeze>) -> Result<()> {
        let b = &mut ctx.accounts.budget;
        require_keys_eq!(ctx.accounts.grantor.key(), b.grantor, BudgetError::Unauthorized);
        b.frozen = true;
        emit!(BudgetFrozen { company: b.company, budget_id: b.budget_id });
        Ok(())
    }

    /// Unfreeze. Grantor signs.
    pub fn unfreeze(ctx: Context<Freeze>) -> Result<()> {
        let b = &mut ctx.accounts.budget;
        require_keys_eq!(ctx.accounts.grantor.key(), b.grantor, BudgetError::Unauthorized);
        b.frozen = false;
        emit!(BudgetUnfrozen { company: b.company, budget_id: b.budget_id });
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct BudgetModuleState {
    pub company: Pubkey,
    pub budget_count: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Budget {
    pub company: Pubkey,
    pub budget_id: [u8; 32],
    pub grantor: Pubkey,
    pub target_role_id: [u8; 32],
    /// Parent budget if hierarchical; [0u8; 32] if sourced from COMPANY directly.
    pub parent_budget_id: [u8; 32],
    pub amount: u64,
    pub spent: u64,
    pub expiry: i64,
    pub frozen: bool,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct InitBudget<'info> {
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
        space = 8 + BudgetModuleState::INIT_SPACE,
        seeds = [b"budget_module", company.key().as_ref()],
        bump,
    )]
    pub module_state: Account<'info, BudgetModuleState>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(budget_id: [u8; 32])]
pub struct CreateBudget<'info> {
    /// Company PDA — must be a real Company account owned by aeqi_company.
    #[account(
        seeds = [b"company", company.company_id.as_ref()],
        bump = company.bump,
        seeds::program = AEQI_COMPANY_ID,
    )]
    pub company: Account<'info, Company>,
    #[account(
        mut,
        seeds = [b"budget_module", company.key().as_ref()],
        bump = module_state.bump,
    )]
    pub module_state: Account<'info, BudgetModuleState>,
    #[account(
        init,
        payer = grantor,
        space = 8 + Budget::INIT_SPACE,
        seeds = [b"budget", company.key().as_ref(), budget_id.as_ref()],
        bump,
    )]
    pub budget: Account<'info, Budget>,
    #[account(mut)]
    pub grantor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordSpend<'info> {
    #[account(
        mut,
        seeds = [b"budget", budget.company.as_ref(), budget.budget_id.as_ref()],
        bump = budget.bump,
    )]
    pub budget: Account<'info, Budget>,
    pub spender_role: Account<'info, Role>,
    pub spender: Signer<'info>,
}

#[derive(Accounts)]
pub struct Freeze<'info> {
    #[account(
        mut,
        seeds = [b"budget", budget.company.as_ref(), budget.budget_id.as_ref()],
        bump = budget.bump,
    )]
    pub budget: Account<'info, Budget>,
    pub grantor: Signer<'info>,
}

#[event]
pub struct BudgetCreated {
    pub company: Pubkey,
    pub budget_id: [u8; 32],
    pub grantor: Pubkey,
    pub target_role_id: [u8; 32],
    pub amount: u64,
    pub expiry: i64,
}

#[event]
pub struct BudgetSpent {
    pub company: Pubkey,
    pub budget_id: [u8; 32],
    pub amount: u64,
    pub total_spent: u64,
}

#[event]
pub struct BudgetFrozen {
    pub company: Pubkey,
    pub budget_id: [u8; 32],
}

#[event]
pub struct BudgetUnfrozen {
    pub company: Pubkey,
    pub budget_id: [u8; 32],
}

#[error_code]
pub enum BudgetError {
    #[msg("amount must be > 0")]
    ZeroAmount,
    #[msg("expiry must be 0 (no expiry) or in the future")]
    InvalidExpiry,
    #[msg("budget is frozen")]
    BudgetFrozen,
    #[msg("budget has expired")]
    BudgetExpired,
    #[msg("spend would exceed budget.amount")]
    ExceedsAllocation,
    #[msg("math overflow")]
    MathOverflow,
    #[msg("caller is not authorized for this budget")]
    Unauthorized,
    #[msg("company must be in creation mode to initialize the budget module")]
    CompanyNotInCreationMode,
}
