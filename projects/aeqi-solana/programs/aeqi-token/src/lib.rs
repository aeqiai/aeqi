//! aeqi_token — cap-table token, SPL Token-2022 mint authority.
//!
//! Each COMPANY gets one Token-2022 mint whose authority is a PDA of this
//! program seeded `[b"token_authority", company]`. Module finalize decodes
//! `(name, symbol, decimals, max_supply, allocations[])` from the company's
//! `BytesConfig` slot `TOKEN_COMPANY_CONFIG_KEY` and creates the mint +
//! initial allocation accounts.
//!
//! This iteration: `init` stores the TokenModuleState PDA. Mint creation via
//! Token-2022 CPI lands as `create_mint` in the next iteration.

// Anchor 0.31 emits external macro warnings under newer Rust check-cfg/deprecation
// lints. Keep this crate's warning output focused on protocol code.
#![allow(deprecated, unexpected_cfgs)]

use aeqi_company::state::Company;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::solana_program::program_pack::Pack;
use anchor_spl::token_2022;
use anchor_spl::token_interface::{
    burn, mint_to, Burn, InitializeMint2, Mint, MintTo, TokenAccount, TokenInterface,
};
use solana_system_interface::instruction as system_instruction;

declare_id!("AxyYnv99gnKJ3VMYbyVjz4BxP8LA34CUnhHGVifrc3Kh");

/// aeqi_company program id — used for cross-program account read of the
/// BytesConfig PDA written by the factory before finalize.
pub const AEQI_COMPANY_ID: Pubkey =
    anchor_lang::pubkey!("CCbs4TCqE6FXmRdyLexx2rSSHAShymWrrR9QWeJUJbXV");

/// Stable PDA-key suffix the factory writes the token's borsh-encoded
/// `TokenInitConfig` blob under, in the company's BytesConfig slot. Each
/// module owns a distinct prefix byte so config-bytes PDAs never collide.
pub const TOKEN_CONFIG_KEY: [u8; 32] = {
    let mut k = [0u8; 32];
    k[0] = 1;
    k
};

/// Mirror of `aeqi_company::BytesConfig` field layout. Borsh-deserialized from
/// the raw account bytes after skipping the 8-byte Anchor discriminator;
/// matches the cross-program account-read pattern used in
/// `aeqi_governance::cast_vote_role`.
#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct BytesConfigData {
    pub company: Pubkey,
    pub key: [u8; 32],
    pub value: Vec<u8>,
    pub bump: u8,
}

/// Borsh-serialized config the factory writes to the company BytesConfig slot
/// at `TOKEN_CONFIG_KEY` before invoking `aeqi_token::finalize`.
#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct TokenInitConfig {
    pub decimals: u8,
    pub max_supply_cap: u64,
}

#[program]
pub mod aeqi_token {
    use super::*;

    /// Module init — called by the factory (or directly by the user during
    /// company spawn). Creates the TokenModuleState PDA that anchors all
    /// subsequent token operations to this company.
    /// Gated to the company authority during creation mode so the
    /// module_state PDA cannot be squatted by an attacker.
    pub fn init(ctx: Context<InitToken>) -> Result<()> {
        let company = &ctx.accounts.company;
        require!(company.creation_mode, TokenError::CompanyNotInCreationMode);
        require_keys_eq!(ctx.accounts.payer.key(), company.authority, TokenError::Unauthorized);

        let module = &mut ctx.accounts.module_state;
        module.company = ctx.accounts.company.key();
        module.mint = Pubkey::default(); // set by create_mint
        module.initialized = ModuleInitState::Initialized as u8;
        module.bump = ctx.bumps.module_state;
        emit!(TokenModuleInitialized {
            company: module.company,
            module_state: ctx.accounts.module_state.key(),
        });
        Ok(())
    }

    /// Module finalize — decodes the config bytes the factory wrote into the
    /// company's BytesConfig slot under `TOKEN_CONFIG_KEY`. Cross-program
    /// account read — the BytesConfig PDA's owner is validated against
    /// AEQI_COMPANY_ID, then the 8-byte discriminator is skipped and the bytes
    /// are borsh-deserialized into the mirror struct.
    pub fn finalize(ctx: Context<FinalizeToken>) -> Result<()> {
        let module = &mut ctx.accounts.module_state;
        require!(
            module.initialized == ModuleInitState::Initialized as u8,
            TokenError::NotInitialized
        );

        let cfg_acct = &ctx.accounts.bytes_config;
        require_keys_eq!(*cfg_acct.owner, AEQI_COMPANY_ID, TokenError::InvalidConfig);

        let data = cfg_acct.try_borrow_data()?;
        let cfg = decode_bytes_config_account(&data)?;
        require_keys_eq!(cfg.company, ctx.accounts.company.key(), TokenError::InvalidConfig);
        require!(cfg.key == TOKEN_CONFIG_KEY, TokenError::InvalidConfig);

        let init_cfg = TokenInitConfig::try_from_slice(&cfg.value)
            .map_err(|_| error!(TokenError::InvalidConfig))?;

        module.decimals = init_cfg.decimals;
        module.max_supply_cap = init_cfg.max_supply_cap;
        module.initialized = ModuleInitState::Finalized as u8;
        Ok(())
    }

    /// Burn cap-table tokens. The token account owner signs; no program
    /// authority needed (Token-2022 burn requires the owner's signature).
    /// Used for redemption, exit, buyback, vesting clawback (when the vault
    /// is owned by a vesting PDA).
    pub fn burn_tokens(ctx: Context<BurnTokens>, amount: u64) -> Result<()> {
        require!(amount > 0, TokenError::ZeroAmount);
        require_token_2022(ctx.accounts.token_program.key())?;
        let module = &ctx.accounts.module_state;
        require!(module.initialized == ModuleInitState::Finalized as u8, TokenError::NotFinalized);
        require!(module.mint == ctx.accounts.mint.key(), TokenError::MintMismatch);
        require_keys_eq!(module.company, ctx.accounts.company.key(), TokenError::CompanyMismatch);

        let cpi_accounts = Burn {
            mint: ctx.accounts.mint.to_account_info(),
            from: ctx.accounts.owner_ta.to_account_info(),
            authority: ctx.accounts.owner.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        burn(cpi_ctx, amount)?;

        emit!(TokensBurned {
            company: module.company,
            mint: module.mint,
            owner_ta: ctx.accounts.owner_ta.key(),
            amount,
        });
        Ok(())
    }

    /// Issue cap-table tokens. Mints `amount` tokens to `recipient_ta` via
    /// CPI into Token-2022, signing with the program-controlled mint
    /// authority PDA seeds. No off-chain key holds mint authority.
    ///
    /// Supply cap: when `module_state.max_supply_cap > 0` the post-mint
    /// total supply is checked against the cap (cap=0 means "uncapped",
    /// only after the module has been finalized with its config).
    pub fn mint_tokens(ctx: Context<MintTokens>, amount: u64) -> Result<()> {
        require!(amount > 0, TokenError::ZeroAmount);
        require_token_2022(ctx.accounts.token_program.key())?;
        let module = &ctx.accounts.module_state;
        require!(module.initialized == ModuleInitState::Finalized as u8, TokenError::NotFinalized);
        require!(module.mint == ctx.accounts.mint.key(), TokenError::MintMismatch);
        require_keys_eq!(module.company, ctx.accounts.company.key(), TokenError::CompanyMismatch);
        require!(ctx.accounts.mint.decimals == module.decimals, TokenError::DecimalsMismatch);
        require_keys_eq!(
            ctx.accounts.authority.key(),
            ctx.accounts.company.authority,
            TokenError::UnauthorizedMintAuthority
        );

        if module.max_supply_cap > 0 {
            let current_supply = ctx.accounts.mint.supply;
            let new_supply =
                current_supply.checked_add(amount).ok_or(error!(TokenError::SupplyCapExceeded))?;
            require!(new_supply <= module.max_supply_cap, TokenError::SupplyCapExceeded);
        }

        let company_key = ctx.accounts.company.key();
        let bump = ctx.bumps.mint_authority;
        let seeds: &[&[&[u8]]] = &[&[b"token_authority", company_key.as_ref(), &[bump]]];

        let cpi_accounts = MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.recipient_ta.to_account_info(),
            authority: ctx.accounts.mint_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            seeds,
        );
        mint_to(cpi_ctx, amount)?;

        emit!(TokensMinted {
            company: module.company,
            mint: module.mint,
            recipient_ta: ctx.accounts.recipient_ta.key(),
            amount,
        });
        Ok(())
    }

    /// Create the SPL Token-2022 mint for this COMPANY. Mint address is a PDA
    /// seeded `[b"mint", company]` so callers can derive it deterministically.
    /// Authority for the mint is another PDA seeded
    /// `[b"token_authority", company]`, owned by this program — only this
    /// program can mint or freeze.
    pub fn create_mint(ctx: Context<CreateMint>, decimals: u8) -> Result<()> {
        require_token_2022(ctx.accounts.token_program.key())?;
        let module = &mut ctx.accounts.module_state;
        require!(module.initialized == ModuleInitState::Finalized as u8, TokenError::NotFinalized);
        require_keys_eq!(module.company, ctx.accounts.company.key(), TokenError::CompanyMismatch);
        require!(decimals == module.decimals, TokenError::DecimalsMismatch);
        require!(module.mint == Pubkey::default(), TokenError::MintAlreadyCreated);

        let mint_key = ctx.accounts.mint.key();
        let mint_bump = ctx.bumps.mint;
        let company_key = ctx.accounts.company.key();
        let mint_len = anchor_spl::token_interface::spl_token_2022::state::Mint::LEN;
        let lamports = Rent::get()?.minimum_balance(mint_len);
        let signer_seeds: &[&[&[u8]]] = &[&[b"mint", company_key.as_ref(), &[mint_bump]]];

        let create_ix = system_instruction::create_account(
            &ctx.accounts.payer.key(),
            &mint_key,
            lamports,
            mint_len as u64,
            &ctx.accounts.token_program.key(),
        );
        invoke_signed(
            &create_ix,
            &[
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer_seeds,
        )?;

        let init_accounts = InitializeMint2 { mint: ctx.accounts.mint.to_account_info() };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), init_accounts);
        anchor_spl::token_interface::initialize_mint2(
            cpi_ctx,
            decimals,
            &ctx.accounts.mint_authority.key(),
            None,
        )?;

        module.mint = mint_key;
        emit!(MintCreated { company: module.company, mint: module.mint, decimals });
        Ok(())
    }
}

fn require_token_2022(token_program: Pubkey) -> Result<()> {
    require_keys_eq!(token_program, token_2022::ID, TokenError::InvalidTokenProgram);
    Ok(())
}

fn decode_bytes_config_account(data: &[u8]) -> Result<BytesConfigData> {
    const DISCRIMINATOR_LEN: usize = 8;
    const PUBKEY_LEN: usize = 32;
    const KEY_LEN: usize = 32;
    const VEC_LEN_PREFIX: usize = 4;
    const FIXED_PREFIX: usize = DISCRIMINATOR_LEN + PUBKEY_LEN + KEY_LEN + VEC_LEN_PREFIX;

    require!(data.len() > FIXED_PREFIX, TokenError::InvalidConfig);
    let mut company_bytes = [0u8; PUBKEY_LEN];
    company_bytes.copy_from_slice(&data[DISCRIMINATOR_LEN..DISCRIMINATOR_LEN + PUBKEY_LEN]);
    let company = Pubkey::new_from_array(company_bytes);

    let key_start = DISCRIMINATOR_LEN + PUBKEY_LEN;
    let mut key = [0u8; KEY_LEN];
    key.copy_from_slice(&data[key_start..key_start + KEY_LEN]);

    let len_start = key_start + KEY_LEN;
    let value_len = u32::from_le_bytes(
        data[len_start..len_start + VEC_LEN_PREFIX]
            .try_into()
            .map_err(|_| error!(TokenError::InvalidConfig))?,
    ) as usize;
    let value_start = len_start + VEC_LEN_PREFIX;
    let value_end = value_start.checked_add(value_len).ok_or(error!(TokenError::InvalidConfig))?;
    require!(value_end < data.len(), TokenError::InvalidConfig);

    Ok(BytesConfigData {
        company,
        key,
        value: data[value_start..value_end].to_vec(),
        bump: data[value_end],
    })
}

#[account]
#[derive(InitSpace)]
pub struct TokenModuleState {
    pub company: Pubkey,
    pub mint: Pubkey,
    pub initialized: u8,
    /// Mint decimals — populated by `finalize` from the BytesConfig blob.
    pub decimals: u8,
    /// Authoritative supply cap from `TokenInitConfig`. `mint_tokens` will
    /// (next iteration) gate against this once minting is wired through it.
    pub max_supply_cap: u64,
    pub bump: u8,
}

#[repr(u8)]
pub enum ModuleInitState {
    Pending = 0,
    Initialized = 1,
    Finalized = 2,
}

#[derive(Accounts)]
pub struct InitToken<'info> {
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
        space = 8 + TokenModuleState::INIT_SPACE,
        seeds = [b"token_module", company.key().as_ref()],
        bump,
    )]
    pub module_state: Account<'info, TokenModuleState>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FinalizeToken<'info> {
    /// CHECK: company pda
    pub company: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"token_module", company.key().as_ref()],
        bump = module_state.bump,
    )]
    pub module_state: Account<'info, TokenModuleState>,
    /// CHECK: cross-program BytesConfig PDA owned by aeqi_company. Anchor
    /// enforces the seed derivation under the foreign program id; finalize's
    /// body validates the account's data layout + owner.
    #[account(
        seeds = [b"cfg_bytes", company.key().as_ref(), TOKEN_CONFIG_KEY.as_ref()],
        bump,
        seeds::program = AEQI_COMPANY_ID,
    )]
    pub bytes_config: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(decimals: u8)]
pub struct CreateMint<'info> {
    /// CHECK: company pda — used as the seed namespace.
    pub company: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"token_module", company.key().as_ref()],
        bump = module_state.bump,
    )]
    pub module_state: Account<'info, TokenModuleState>,
    /// CHECK: program-controlled PDA mint authority. Only this program (via
    /// signer seeds) can mint or freeze the cap-table token.
    #[account(seeds = [b"token_authority", company.key().as_ref()], bump)]
    pub mint_authority: UncheckedAccount<'info>,
    /// CHECK: mint PDA is created and initialized manually in `create_mint`.
    #[account(
        mut,
        seeds = [b"mint", company.key().as_ref()],
        bump,
    )]
    pub mint: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BurnTokens<'info> {
    /// CHECK: company pda — used as the seed namespace.
    pub company: UncheckedAccount<'info>,
    #[account(
        seeds = [b"token_module", company.key().as_ref()],
        bump = module_state.bump,
    )]
    pub module_state: Account<'info, TokenModuleState>,
    #[account(mut, seeds = [b"mint", company.key().as_ref()], bump)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub owner_ta: InterfaceAccount<'info, TokenAccount>,
    pub owner: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct MintTokens<'info> {
    #[account(
        seeds = [b"company", company.company_id.as_ref()],
        bump = company.bump,
        seeds::program = AEQI_COMPANY_ID,
    )]
    pub company: Account<'info, Company>,
    #[account(
        seeds = [b"token_module", company.key().as_ref()],
        bump = module_state.bump,
    )]
    pub module_state: Account<'info, TokenModuleState>,
    /// CHECK: program-controlled PDA mint authority. Signed via signer seeds.
    #[account(seeds = [b"token_authority", company.key().as_ref()], bump)]
    pub mint_authority: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"mint", company.key().as_ref()], bump)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub recipient_ta: InterfaceAccount<'info, TokenAccount>,
    pub authority: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[event]
pub struct TokenModuleInitialized {
    pub company: Pubkey,
    pub module_state: Pubkey,
}

#[event]
pub struct MintCreated {
    pub company: Pubkey,
    pub mint: Pubkey,
    pub decimals: u8,
}

#[event]
pub struct TokensMinted {
    pub company: Pubkey,
    pub mint: Pubkey,
    pub recipient_ta: Pubkey,
    pub amount: u64,
}

#[event]
pub struct TokensBurned {
    pub company: Pubkey,
    pub mint: Pubkey,
    pub owner_ta: Pubkey,
    pub amount: u64,
}

#[error_code]
pub enum TokenError {
    #[msg("token module not yet initialized")]
    NotInitialized,
    #[msg("token module must be finalized before mint operations")]
    NotFinalized,
    #[msg("mint already created for this company")]
    MintAlreadyCreated,
    #[msg("mint account does not match the module's recorded mint")]
    MintMismatch,
    #[msg("BytesConfig PDA missing, malformed, or wrong owner")]
    InvalidConfig,
    #[msg("mint would exceed max_supply_cap from TokenInitConfig")]
    SupplyCapExceeded,
    #[msg("token program must be Token-2022")]
    InvalidTokenProgram,
    #[msg("token module is not bound to the supplied company")]
    CompanyMismatch,
    #[msg("caller is not the company authority for minting")]
    UnauthorizedMintAuthority,
    #[msg("amount must be > 0")]
    ZeroAmount,
    #[msg("mint decimals must match finalized token config")]
    DecimalsMismatch,
    #[msg("caller is not authorized for this company")]
    Unauthorized,
    #[msg("company must be in creation mode to initialize the token module")]
    CompanyNotInCreationMode,
}
