//! aeqi_trust — core protocol program.
//!
//! The TRUST PDA is the authority root for an AEQI organization.
//! It owns the module registry and config store. Creation mode is the only
//! phase where the authority can register modules; once finalized, the trust
//! becomes live and config writes remain authority-gated in this iteration.

// Anchor 0.31 emits external macro warnings under newer Rust check-cfg/deprecation
// lints. Keep this crate's warning output focused on protocol code.
#![allow(deprecated, unexpected_cfgs)]

use anchor_lang::prelude::*;

declare_id!("CCbs4TCqE6FXmRdyLexx2rSSHAShymWrrR9QWeJUJbXV");

pub mod acl;
pub mod errors;
pub mod state;

pub use acl::*;
pub use errors::*;
pub use state::*;

#[program]
pub mod aeqi_trust {
    use super::*;

    /// Create a fresh TRUST PDA. Enters creation mode — ACL checks are skipped
    /// until `finalize` is called. Only the `authority` (factory or owning
    /// account) may register modules and set configs while in creation mode.
    pub fn initialize(ctx: Context<Initialize>, trust_id: [u8; 32]) -> Result<()> {
        let trust = &mut ctx.accounts.trust;
        trust.trust_id = trust_id;
        trust.authority = ctx.accounts.authority.key();
        trust.creation_mode = true;
        trust.paused = false;
        trust.module_count = 0;
        trust.bump = ctx.bumps.trust;
        emit!(TrustInitialized { trust: trust.key(), trust_id, authority: trust.authority });
        Ok(())
    }

    /// Register a module program against this TRUST during creation. Stores the
    /// selected provider implementation metadata plus initial ACL bit-flags.
    /// After finalization, module implementation changes happen through
    /// `adopt_module_implementation`.
    pub fn register_module(
        ctx: Context<RegisterModule>,
        module_id: [u8; 32],
        program_id: Pubkey,
        provider: Pubkey,
        implementation_version: u64,
        implementation_metadata_hash: [u8; 32],
        trust_acl: u64,
    ) -> Result<()> {
        let trust = &mut ctx.accounts.trust;
        require!(!trust.paused, AeqiTrustError::TrustPaused);
        require!(implementation_version > 0, AeqiTrustError::InvalidImplementationVersion);

        require!(trust.creation_mode, AeqiTrustError::NotInCreationMode);
        require_keys_eq!(
            ctx.accounts.authority.key(),
            trust.authority,
            AeqiTrustError::Unauthorized
        );

        let module = &mut ctx.accounts.module;
        module.trust = trust.key();
        module.module_id = module_id;
        module.program_id = program_id;
        module.provider = provider;
        module.implementation_version = implementation_version;
        module.implementation_metadata_hash = implementation_metadata_hash;
        module.trust_acl = trust_acl;
        module.initialized = ModuleInitState::Pending as u8;
        module.bump = ctx.bumps.module;

        bump_module_count(trust)?;

        emit!(ModuleRegistered {
            trust: trust.key(),
            module_id,
            program_id,
            provider,
            implementation_version,
            implementation_metadata_hash,
            trust_acl,
        });
        Ok(())
    }

    /// Publish a provider-owned implementation candidate. This does not mutate
    /// any TRUST. Each TRUST pulls an implementation into a module slot through
    /// `adopt_module_implementation`.
    pub fn publish_module_implementation(
        ctx: Context<PublishModuleImplementation>,
        module_id: [u8; 32],
        version: u64,
        metadata_hash: [u8; 32],
    ) -> Result<()> {
        require!(version > 0, AeqiTrustError::InvalidImplementationVersion);
        require!(
            ctx.accounts.implementation_program.executable,
            AeqiTrustError::ImplementationProgramNotExecutable
        );

        let implementation = &mut ctx.accounts.implementation;
        implementation.provider = ctx.accounts.provider.key();
        implementation.module_id = module_id;
        implementation.implementation_program_id = ctx.accounts.implementation_program.key();
        implementation.version = version;
        implementation.metadata_hash = metadata_hash;
        implementation.active = true;
        implementation.bump = ctx.bumps.implementation;

        emit!(ModuleImplementationPublished {
            provider: implementation.provider,
            module_id,
            version,
            implementation_program_id: implementation.implementation_program_id,
            metadata_hash,
        });
        Ok(())
    }

    /// Provider kill-switch for a published implementation. Existing TRUSTs do
    /// not move automatically; this only prevents future adoption through this
    /// catalog entry.
    pub fn set_module_implementation_active(
        ctx: Context<SetModuleImplementationActive>,
        active: bool,
    ) -> Result<()> {
        let implementation = &mut ctx.accounts.implementation;
        require_keys_eq!(
            ctx.accounts.provider.key(),
            implementation.provider,
            AeqiTrustError::Unauthorized
        );
        implementation.active = active;
        emit!(ModuleImplementationActiveChanged {
            provider: implementation.provider,
            module_id: implementation.module_id,
            version: implementation.version,
            active,
        });
        Ok(())
    }

    /// Pull a provider-published implementation into one module slot for one
    /// TRUST. This is the Solana-native replacement for global beacon upgrades:
    /// providers publish, but the TRUST authority chooses when to adopt.
    pub fn adopt_module_implementation(
        ctx: Context<AdoptModuleImplementation>,
        trust_acl: u64,
    ) -> Result<()> {
        let trust = &ctx.accounts.trust;
        require!(!trust.paused, AeqiTrustError::TrustPaused);
        require!(!trust.creation_mode, AeqiTrustError::TrustNotFinalized);
        require_keys_eq!(
            ctx.accounts.authority.key(),
            trust.authority,
            AeqiTrustError::Unauthorized
        );

        let implementation = &ctx.accounts.implementation;
        require!(implementation.active, AeqiTrustError::InactiveImplementation);

        let module = &mut ctx.accounts.module;
        require!(
            module.module_id == implementation.module_id,
            AeqiTrustError::ImplementationModuleMismatch
        );

        module.program_id = implementation.implementation_program_id;
        module.provider = implementation.provider;
        module.implementation_version = implementation.version;
        module.implementation_metadata_hash = implementation.metadata_hash;
        module.trust_acl = trust_acl;

        emit!(ModuleImplementationAdopted {
            trust: trust.key(),
            module_id: module.module_id,
            provider: implementation.provider,
            version: implementation.version,
            implementation_program_id: implementation.implementation_program_id,
            metadata_hash: implementation.metadata_hash,
            trust_acl,
        });
        Ok(())
    }

    /// Set the ACL bitmask between two modules. Authority-only in this
    /// iteration; live module-signed ACL mutation is not enabled yet.
    pub fn set_module_acl(
        ctx: Context<SetModuleAcl>,
        target_module_id: [u8; 32],
        flags: u64,
    ) -> Result<()> {
        let trust = &ctx.accounts.trust;
        require!(!trust.paused, AeqiTrustError::TrustPaused);

        require_keys_eq!(
            ctx.accounts.authority.key(),
            trust.authority,
            AeqiTrustError::Unauthorized
        );

        let target_module = &ctx.accounts.target_module;
        require!(
            target_module.module_id == target_module_id,
            AeqiTrustError::AclTargetModuleMismatch
        );

        let edge = &mut ctx.accounts.acl_edge;
        edge.trust = trust.key();
        edge.source_module_id = ctx.accounts.source_module.module_id;
        edge.target_module_id = target_module_id;
        edge.flags = flags;
        edge.bump = ctx.bumps.acl_edge;

        emit!(ModuleAclSet {
            trust: trust.key(),
            source_module_id: edge.source_module_id,
            target_module_id,
            flags,
        });
        Ok(())
    }

    /// Exit creation mode — ACL checks become live.
    pub fn finalize(ctx: Context<Finalize>) -> Result<()> {
        let trust = &mut ctx.accounts.trust;
        require_keys_eq!(
            ctx.accounts.authority.key(),
            trust.authority,
            AeqiTrustError::Unauthorized
        );
        require!(!trust.paused, AeqiTrustError::TrustPaused);
        require!(trust.creation_mode, AeqiTrustError::AlreadyFinalized);
        require!(trust.module_count > 0, AeqiTrustError::NoModulesRegistered);
        trust.creation_mode = false;
        emit!(TrustFinalized { trust: trust.key(), module_count: trust.module_count });
        Ok(())
    }

    /// Set a numeric config slot (u128). Authority-only in this iteration.
    pub fn set_numeric_config(
        ctx: Context<SetNumericConfig>,
        key: [u8; 32],
        value: u128,
    ) -> Result<()> {
        gate_config_write(&ctx.accounts.trust, ctx.accounts.authority.key())?;
        let cfg = &mut ctx.accounts.config;
        cfg.trust = ctx.accounts.trust.key();
        cfg.key = key;
        cfg.value = value;
        cfg.bump = ctx.bumps.config;
        Ok(())
    }

    /// Set an address config slot (Pubkey). Authority-only in this iteration.
    pub fn set_address_config(
        ctx: Context<SetAddressConfig>,
        key: [u8; 32],
        value: Pubkey,
    ) -> Result<()> {
        gate_config_write(&ctx.accounts.trust, ctx.accounts.authority.key())?;
        let cfg = &mut ctx.accounts.config;
        cfg.trust = ctx.accounts.trust.key();
        cfg.key = key;
        cfg.value = value;
        cfg.bump = ctx.bumps.config;
        Ok(())
    }

    /// Set a bytes config slot (Vec<u8>). Authority-only in this iteration.
    pub fn set_bytes_config(
        ctx: Context<SetBytesConfig>,
        key: [u8; 32],
        value: Vec<u8>,
    ) -> Result<()> {
        require!(value.len() <= MAX_BYTES_CONFIG, AeqiTrustError::ConfigTooLarge);
        gate_config_write(&ctx.accounts.trust, ctx.accounts.authority.key())?;
        let cfg = &mut ctx.accounts.config;
        cfg.trust = ctx.accounts.trust.key();
        cfg.key = key;
        cfg.value = value;
        cfg.bump = ctx.bumps.config;
        Ok(())
    }

    /// Pause / unpause the TRUST. Pause blocks all mutating ops.
    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        let trust = &mut ctx.accounts.trust;
        require_keys_eq!(
            ctx.accounts.authority.key(),
            trust.authority,
            AeqiTrustError::Unauthorized
        );
        trust.paused = paused;
        emit!(TrustPauseChanged { trust: trust.key(), paused });
        Ok(())
    }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/// Gate logic shared by every config-write ix. Config mutation is authority-only
/// in this iteration.
fn gate_config_write(trust: &Account<Trust>, signer: Pubkey) -> Result<()> {
    require!(!trust.paused, AeqiTrustError::TrustPaused);
    require_keys_eq!(signer, trust.authority, AeqiTrustError::Unauthorized);
    Ok(())
}

fn bump_module_count(trust: &mut Account<Trust>) -> Result<()> {
    trust.module_count =
        trust.module_count.checked_add(1).ok_or(error!(AeqiTrustError::MathOverflow))?;
    Ok(())
}

pub const MAX_BYTES_CONFIG: usize = 1024;

// -----------------------------------------------------------------------------
// Account contexts
// -----------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(trust_id: [u8; 32])]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Trust::INIT_SPACE,
        seeds = [b"trust", trust_id.as_ref()],
        bump,
    )]
    pub trust: Account<'info, Trust>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(module_id: [u8; 32])]
pub struct RegisterModule<'info> {
    #[account(
        mut,
        seeds = [b"trust", trust.trust_id.as_ref()],
        bump = trust.bump,
    )]
    pub trust: Account<'info, Trust>,
    #[account(
        init,
        payer = authority,
        space = 8 + Module::INIT_SPACE,
        seeds = [b"module", trust.key().as_ref(), module_id.as_ref()],
        bump,
    )]
    pub module: Account<'info, Module>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(module_id: [u8; 32], version: u64)]
pub struct PublishModuleImplementation<'info> {
    #[account(
        init,
        payer = provider,
        space = 8 + ModuleImplementation::INIT_SPACE,
        seeds = [
            b"module_impl",
            provider.key().as_ref(),
            module_id.as_ref(),
            version.to_le_bytes().as_ref(),
        ],
        bump,
    )]
    pub implementation: Account<'info, ModuleImplementation>,
    /// CHECK: this account is stored as the implementation program id and is
    /// constrained to executable so the catalog cannot point at arbitrary data.
    pub implementation_program: UncheckedAccount<'info>,
    #[account(mut)]
    pub provider: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetModuleImplementationActive<'info> {
    #[account(
        mut,
        seeds = [
            b"module_impl",
            implementation.provider.as_ref(),
            implementation.module_id.as_ref(),
            implementation.version.to_le_bytes().as_ref(),
        ],
        bump = implementation.bump,
    )]
    pub implementation: Account<'info, ModuleImplementation>,
    pub provider: Signer<'info>,
}

#[derive(Accounts)]
pub struct AdoptModuleImplementation<'info> {
    #[account(
        seeds = [b"trust", trust.trust_id.as_ref()],
        bump = trust.bump,
    )]
    pub trust: Account<'info, Trust>,
    #[account(
        mut,
        seeds = [b"module", trust.key().as_ref(), module.module_id.as_ref()],
        bump = module.bump,
        constraint = module.trust == trust.key() @ AeqiTrustError::ImplementationModuleMismatch,
    )]
    pub module: Account<'info, Module>,
    #[account(
        seeds = [
            b"module_impl",
            implementation.provider.as_ref(),
            implementation.module_id.as_ref(),
            implementation.version.to_le_bytes().as_ref(),
        ],
        bump = implementation.bump,
    )]
    pub implementation: Account<'info, ModuleImplementation>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(target_module_id: [u8; 32])]
pub struct SetModuleAcl<'info> {
    #[account(
        seeds = [b"trust", trust.trust_id.as_ref()],
        bump = trust.bump,
    )]
    pub trust: Account<'info, Trust>,
    #[account(
        seeds = [b"module", trust.key().as_ref(), source_module.module_id.as_ref()],
        bump = source_module.bump,
        constraint = source_module.trust == trust.key() @ AeqiTrustError::AclSourceModuleMismatch,
    )]
    pub source_module: Account<'info, Module>,
    #[account(
        seeds = [b"module", trust.key().as_ref(), target_module_id.as_ref()],
        bump = target_module.bump,
        constraint = target_module.trust == trust.key() @ AeqiTrustError::AclTargetModuleMismatch,
    )]
    pub target_module: Account<'info, Module>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + ModuleAclEdge::INIT_SPACE,
        seeds = [b"acl_edge", trust.key().as_ref(), source_module.module_id.as_ref(), target_module_id.as_ref()],
        bump,
    )]
    pub acl_edge: Account<'info, ModuleAclEdge>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Finalize<'info> {
    #[account(
        mut,
        seeds = [b"trust", trust.trust_id.as_ref()],
        bump = trust.bump,
    )]
    pub trust: Account<'info, Trust>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(key: [u8; 32])]
pub struct SetNumericConfig<'info> {
    #[account(
        seeds = [b"trust", trust.trust_id.as_ref()],
        bump = trust.bump,
    )]
    pub trust: Account<'info, Trust>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + NumericConfig::INIT_SPACE,
        seeds = [b"cfg_num", trust.key().as_ref(), key.as_ref()],
        bump,
    )]
    pub config: Account<'info, NumericConfig>,
    /// Reserved for future live-mode module-auth wiring.
    pub source_module: Option<Account<'info, Module>>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(key: [u8; 32])]
pub struct SetAddressConfig<'info> {
    #[account(
        seeds = [b"trust", trust.trust_id.as_ref()],
        bump = trust.bump,
    )]
    pub trust: Account<'info, Trust>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + AddressConfig::INIT_SPACE,
        seeds = [b"cfg_addr", trust.key().as_ref(), key.as_ref()],
        bump,
    )]
    pub config: Account<'info, AddressConfig>,
    /// Reserved for future live-mode module-auth wiring.
    pub source_module: Option<Account<'info, Module>>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(key: [u8; 32], value: Vec<u8>)]
pub struct SetBytesConfig<'info> {
    #[account(
        seeds = [b"trust", trust.trust_id.as_ref()],
        bump = trust.bump,
    )]
    pub trust: Account<'info, Trust>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + BytesConfig::INIT_SPACE_BASE + MAX_BYTES_CONFIG,
        seeds = [b"cfg_bytes", trust.key().as_ref(), key.as_ref()],
        bump,
    )]
    pub config: Account<'info, BytesConfig>,
    /// Reserved for future live-mode module-auth wiring.
    pub source_module: Option<Account<'info, Module>>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(
        mut,
        seeds = [b"trust", trust.trust_id.as_ref()],
        bump = trust.bump,
    )]
    pub trust: Account<'info, Trust>,
    /// Reserved for future live-mode module-auth wiring.
    pub source_module: Option<Account<'info, Module>>,
    pub authority: Signer<'info>,
}

// -----------------------------------------------------------------------------
// Events
// -----------------------------------------------------------------------------

#[event]
pub struct TrustInitialized {
    pub trust: Pubkey,
    pub trust_id: [u8; 32],
    pub authority: Pubkey,
}

#[event]
pub struct TrustFinalized {
    pub trust: Pubkey,
    pub module_count: u32,
}

#[event]
pub struct TrustPauseChanged {
    pub trust: Pubkey,
    pub paused: bool,
}

#[event]
pub struct ModuleRegistered {
    pub trust: Pubkey,
    pub module_id: [u8; 32],
    pub program_id: Pubkey,
    pub provider: Pubkey,
    pub implementation_version: u64,
    pub implementation_metadata_hash: [u8; 32],
    pub trust_acl: u64,
}

#[event]
pub struct ModuleImplementationPublished {
    pub provider: Pubkey,
    pub module_id: [u8; 32],
    pub version: u64,
    pub implementation_program_id: Pubkey,
    pub metadata_hash: [u8; 32],
}

#[event]
pub struct ModuleImplementationActiveChanged {
    pub provider: Pubkey,
    pub module_id: [u8; 32],
    pub version: u64,
    pub active: bool,
}

#[event]
pub struct ModuleImplementationAdopted {
    pub trust: Pubkey,
    pub module_id: [u8; 32],
    pub provider: Pubkey,
    pub version: u64,
    pub implementation_program_id: Pubkey,
    pub metadata_hash: [u8; 32],
    pub trust_acl: u64,
}

#[event]
pub struct ModuleAclSet {
    pub trust: Pubkey,
    pub source_module_id: [u8; 32],
    pub target_module_id: [u8; 32],
    pub flags: u64,
}
