//! aeqi_treasury — USDC vault for an AEQI company.
//!
//! A treasury holds USDC (or other SPL tokens) in a program-controlled vault
//! ATA. Deposits are permissionless. Withdrawals are gated by either the
//! COMPANY authority (creation mode) or a successful governance proposal CPI
//! (live mode) — for now this skeleton accepts the company authority signing
//! directly; full governance gating lands once `aeqi_governance.execute_proposal`
//! grows ix dispatch.

// Anchor 0.31 emits external macro warnings under newer Rust check-cfg/deprecation
// lints. Keep this crate's warning output focused on protocol code.
#![allow(deprecated, unexpected_cfgs)]

use aeqi_company::state::Company;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

declare_id!("2KBH4dhAM8fvix5sB44f55Hy6mE4HgeMMbm3htZTJNm7");

/// aeqi_company program id — used for cross-program PDA derivation of the
/// company account so module setup paths cannot accept arbitrary company pubkeys.
pub const AEQI_COMPANY_ID: Pubkey =
    anchor_lang::pubkey!("CCbs4TCqE6FXmRdyLexx2rSSHAShymWrrR9QWeJUJbXV");

#[program]
pub mod aeqi_treasury {
    use super::*;

    /// Module init — called by the company authority during the company's
    /// creation mode. Gating:
    ///   - `company` PDA must be derived under aeqi_company and decoded (no fake
    ///     pubkeys / no PDA squatting on attacker-owned accounts).
    ///   - signer (`payer`) must equal `company.authority`.
    ///   - company must still be in creation mode — module slots are not
    ///     reconfigurable once the company goes live in this iteration.
    pub fn init(ctx: Context<InitTreasury>, treasury_authority: Pubkey) -> Result<()> {
        let company = &ctx.accounts.company;
        require!(company.creation_mode, TreasuryError::CompanyNotInCreationMode);
        require_keys_eq!(ctx.accounts.payer.key(), company.authority, TreasuryError::Unauthorized);

        let m = &mut ctx.accounts.module_state;
        m.company = ctx.accounts.company.key();
        m.treasury_authority = treasury_authority;
        m.bump = ctx.bumps.module_state;
        Ok(())
    }

    /// Deposit `amount` into the treasury vault. Permissionless — anyone
    /// can fund the treasury. Wraps the SPL transfer so the indexer gets a
    /// typed `TreasuryDeposited` event instead of having to filter raw
    /// Token-2022 transfers.
    pub fn deposit(ctx: Context<TreasuryDeposit>, amount: u64) -> Result<()> {
        let cpi = TransferChecked {
            from: ctx.accounts.depositor_ta.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.depositor.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi);
        transfer_checked(cpi_ctx, amount, ctx.accounts.mint.decimals)?;

        emit!(TreasuryDeposited {
            company: ctx.accounts.module_state.company,
            depositor_ta: ctx.accounts.depositor_ta.key(),
            amount,
        });
        Ok(())
    }

    /// Withdraw `amount` from the treasury vault to `recipient_ta`. The
    /// vault is owned by the program-controlled PDA
    /// `[b"treasury_vault_authority", company]`; we sign via PDA seeds.
    /// Authority gate: caller must equal `module_state.treasury_authority`.
    pub fn withdraw(ctx: Context<TreasuryWithdraw>, amount: u64) -> Result<()> {
        let m = &ctx.accounts.module_state;
        require_keys_eq!(
            ctx.accounts.authority.key(),
            m.treasury_authority,
            TreasuryError::Unauthorized
        );

        let company_key = ctx.accounts.company.key();
        let bump = ctx.bumps.vault_authority;
        let seeds: &[&[&[u8]]] = &[&[b"treasury_vault_authority", company_key.as_ref(), &[bump]]];

        let cpi = TransferChecked {
            from: ctx.accounts.vault.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.recipient_ta.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        let cpi_ctx =
            CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi, seeds);
        transfer_checked(cpi_ctx, amount, ctx.accounts.mint.decimals)?;

        emit!(TreasuryWithdrew {
            company: m.company,
            recipient_ta: ctx.accounts.recipient_ta.key(),
            amount,
        });
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct TreasuryModuleState {
    pub company: Pubkey,
    /// The single account allowed to authorize withdrawals. In creation mode
    /// the factory sets this to the company authority; in live mode it gets
    /// rewritten to a governance-signer PDA so withdrawals require an executed
    /// proposal.
    pub treasury_authority: Pubkey,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct InitTreasury<'info> {
    /// Company PDA — must be a real Company account owned by aeqi_company.
    /// `seeds::program` binds derivation to the aeqi_company program ID; the
    /// `Account<Company>` typing forces deserialization, so attackers can't
    /// substitute an arbitrary keypair to PDA-squat the module_state slot.
    #[account(
        seeds = [b"company", company.company_id.as_ref()],
        bump = company.bump,
        seeds::program = AEQI_COMPANY_ID,
    )]
    pub company: Account<'info, Company>,
    #[account(
        init,
        payer = payer,
        space = 8 + TreasuryModuleState::INIT_SPACE,
        seeds = [b"treasury_module", company.key().as_ref()],
        bump,
    )]
    pub module_state: Account<'info, TreasuryModuleState>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TreasuryDeposit<'info> {
    /// CHECK: company pda
    pub company: UncheckedAccount<'info>,
    #[account(
        seeds = [b"treasury_module", company.key().as_ref()],
        bump = module_state.bump,
    )]
    pub module_state: Account<'info, TreasuryModuleState>,
    /// CHECK: vault authority PDA — used as the seed namespace for the vault.
    /// Doesn't sign the deposit (depositor signs).
    #[account(seeds = [b"treasury_vault_authority", company.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = vault_authority)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint)]
    pub depositor_ta: InterfaceAccount<'info, TokenAccount>,
    pub depositor: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct TreasuryWithdraw<'info> {
    /// CHECK: company pda
    pub company: UncheckedAccount<'info>,
    #[account(
        seeds = [b"treasury_module", company.key().as_ref()],
        bump = module_state.bump,
    )]
    pub module_state: Account<'info, TreasuryModuleState>,
    /// CHECK: program-controlled vault authority PDA. Signed via signer seeds.
    #[account(seeds = [b"treasury_vault_authority", company.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = vault_authority)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint)]
    pub recipient_ta: InterfaceAccount<'info, TokenAccount>,
    pub authority: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[event]
pub struct TreasuryWithdrew {
    pub company: Pubkey,
    pub recipient_ta: Pubkey,
    pub amount: u64,
}

#[event]
pub struct TreasuryDeposited {
    pub company: Pubkey,
    pub depositor_ta: Pubkey,
    pub amount: u64,
}

#[error_code]
pub enum TreasuryError {
    #[msg("caller is not the configured treasury authority")]
    Unauthorized,
    #[msg("company must be in creation mode to initialize the treasury module")]
    CompanyNotInCreationMode,
}
