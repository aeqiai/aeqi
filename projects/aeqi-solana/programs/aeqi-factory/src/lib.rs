//! aeqi_factory — on-chain DAO factory.
//!
//! Template registry + company instantiation flow.
//!
//! The canonical create flow is:
//!
//! 1. Create the COMPANY PDA.
//! 2. Register every module declared by the template.
//! 3. Wire ACL edges between modules.
//! 4. Finalize each module so it loads its config.
//! 5. Finalize COMPANY to exit creation mode.
//!
//! `create_company` ships step 1 as a standalone helper. The full template
//! pipeline is `instantiate_template`: templates land on-chain via
//! `register_template` and are replayed against a fresh COMPANY by the next
//! provisioning step.

// Anchor 0.31 emits external macro warnings under newer Rust check-cfg/deprecation
// lints. Keep this crate's warning output focused on protocol code.
#![allow(clippy::too_many_arguments, deprecated, unexpected_cfgs)]

use aeqi_governance::cpi::accounts::{FinalizeGovernance, InitGovernance};
use aeqi_governance::program::AeqiGovernance;
use aeqi_role::cpi::accounts::{FinalizeModule as RoleFinalize, InitModule as RoleInit};
use aeqi_role::program::AeqiRole;
use aeqi_token::cpi::accounts::{FinalizeToken, InitToken};
use aeqi_token::program::AeqiToken;
use aeqi_company::cpi::accounts::{
    Finalize as CompanyFinalize, Initialize as CompanyInitialize,
    RegisterModule as CompanyRegisterModule, SetBytesConfig as CompanySetBytesConfig,
    SetModuleAcl as CompanySetModuleAcl,
};
use aeqi_company::program::AeqiCompany;
use anchor_lang::prelude::*;

declare_id!("3qRT5qTuv4wkqbLfZQUVcf94QRyG3JdCAbFZsiBNpgEv");

pub mod state;
pub use state::*;

#[program]
pub mod aeqi_factory {
    use super::*;

    /// Skeleton create flow — initializes a fresh COMPANY PDA via CPI into
    /// `aeqi_company::initialize`. The caller becomes the company authority.
    /// Module registration and finalization follow in `instantiate_template`.
    pub fn create_company(ctx: Context<CreateCompany>, company_id: [u8; 32]) -> Result<()> {
        let cpi_accounts = CompanyInitialize {
            company: ctx.accounts.company.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
        };
        let cpi_ctx =
            CpiContext::new(ctx.accounts.aeqi_company_program.to_account_info(), cpi_accounts);
        aeqi_company::cpi::initialize(cpi_ctx, company_id)?;

        emit!(CompanyCreated {
            company: ctx.accounts.company.key(),
            company_id,
            authority: ctx.accounts.authority.key(),
        });
        Ok(())
    }

    /// Partial spawn — initialize a fresh company and register a module set,
    /// **leaving the company in creation mode** so the caller can run each
    /// module's `init` CPI before finalizing. Use this when the caller
    /// owns the module-init step (the canonical use case is an off-chain
    /// provisioner that submits init CPIs in follow-up transactions);
    /// for the fully-atomic role + token + governance shape, prefer
    /// `create_company_full`, which packs init + register + module-init
    /// + finalize into one transaction.
    ///
    /// Steps:
    ///
    ///   1. CPI `aeqi_company::initialize` (creates Company PDA in creation mode).
    ///   2. For each `ModuleSpec` in `modules`, CPI `aeqi_company::register_module`.
    ///      The matching module PDAs are passed in `remaining_accounts`.
    ///
    /// **Does NOT finalize.** Earlier versions of this function called
    /// `aeqi_company::finalize` at step 3, which locked out every
    /// subsequent module init — `aeqi_*::init` requires the company be in
    /// creation mode. Callers that need register + per-module init +
    /// finalize MUST issue the finalize CPI themselves once the inits
    /// land. Cost of the prior shape (2026-05-17): every off-chain
    /// company-provisioning attempt failed with `CompanyNotInCreationMode`
    /// because the factory finalized before the inits could run.
    ///
    /// `remaining_accounts` layout: for each module spec, push the module PDA
    /// (writable, will be initialized by `aeqi_company`).
    ///
    /// The caller (the `authority`) signs all CPIs as the company authority.
    pub fn create_with_modules<'info>(
        ctx: Context<'_, '_, 'info, 'info, CreateWithModules<'info>>,
        company_id: [u8; 32],
        modules: Vec<ModuleSpec>,
    ) -> Result<()> {
        require!(!modules.is_empty(), FactoryError::EmptyModuleSet);
        require!(modules.len() <= 16, FactoryError::TooManyModules);
        require!(
            ctx.remaining_accounts.len() == modules.len(),
            FactoryError::ModuleAccountCountMismatch
        );

        // 1. initialize
        let init_accounts = CompanyInitialize {
            company: ctx.accounts.company.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
        };
        let init_ctx =
            CpiContext::new(ctx.accounts.aeqi_company_program.to_account_info(), init_accounts);
        aeqi_company::cpi::initialize(init_ctx, company_id)?;

        // 2. register every module
        for (spec, module_acct) in modules.iter().zip(ctx.remaining_accounts.iter()) {
            let reg_accounts = CompanyRegisterModule {
                company: ctx.accounts.company.to_account_info(),
                module: module_acct.clone(),
                authority: ctx.accounts.authority.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
            };
            let reg_ctx =
                CpiContext::new(ctx.accounts.aeqi_company_program.to_account_info(), reg_accounts);
            aeqi_company::cpi::register_module(
                reg_ctx,
                spec.module_id,
                spec.program_id,
                spec.provider,
                spec.implementation_version,
                spec.implementation_metadata_hash,
                spec.company_acl,
            )?;
        }

        // 3. (intentionally NOT finalizing — see docstring above)

        emit!(CompanySpawned {
            company: ctx.accounts.company.key(),
            company_id,
            authority: ctx.accounts.authority.key(),
            module_count: modules.len() as u8,
        });
        Ok(())
    }

    /// Full atomic spawn — runs the canonical 3-module configuration
    /// (role + token + governance) in one tx:
    ///
    ///   1. CPI `aeqi_company::initialize` (creates company PDA, creation mode)
    ///   2. CPI `aeqi_company::register_module` ×3 (one per module slot)
    ///   3. CPI each module's `init` (creates its module-state PDA bound
    ///      to the company)
    ///   4. CPI `aeqi_company::finalize` (exits creation mode)
    ///
    /// Module finalize CPIs (config-bytes decode) are NOT yet called here;
    /// that requires the BytesConfig dispatch flow which follows.
    /// Tx size: ~13 accounts; should fit comfortably in 1232 bytes.
    pub fn create_company_full(
        ctx: Context<CreateCompanyFull>,
        company_id: [u8; 32],
        role_module_id: [u8; 32],
        token_module_id: [u8; 32],
        gov_module_id: [u8; 32],
        role_acl: u64,
        token_acl: u64,
        gov_acl: u64,
        token_decimals: u8,
        token_max_supply_cap: u64,
    ) -> Result<()> {
        // 1. initialize company
        let init_accs = CompanyInitialize {
            company: ctx.accounts.company.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
        };
        aeqi_company::cpi::initialize(
            CpiContext::new(ctx.accounts.aeqi_company_program.to_account_info(), init_accs),
            company_id,
        )?;

        // 2. register the 3 modules on company (one CPI each)
        aeqi_company::cpi::register_module(
            CpiContext::new(
                ctx.accounts.aeqi_company_program.to_account_info(),
                CompanyRegisterModule {
                    company: ctx.accounts.company.to_account_info(),
                    module: ctx.accounts.role_module.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                },
            ),
            role_module_id,
            ctx.accounts.aeqi_role_program.key(),
            ctx.accounts.aeqi_role_program.key(),
            1,
            [0; 32],
            role_acl,
        )?;
        aeqi_company::cpi::register_module(
            CpiContext::new(
                ctx.accounts.aeqi_company_program.to_account_info(),
                CompanyRegisterModule {
                    company: ctx.accounts.company.to_account_info(),
                    module: ctx.accounts.token_module.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                },
            ),
            token_module_id,
            ctx.accounts.aeqi_token_program.key(),
            ctx.accounts.aeqi_token_program.key(),
            1,
            [0; 32],
            token_acl,
        )?;
        aeqi_company::cpi::register_module(
            CpiContext::new(
                ctx.accounts.aeqi_company_program.to_account_info(),
                CompanyRegisterModule {
                    company: ctx.accounts.company.to_account_info(),
                    module: ctx.accounts.gov_module.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                },
            ),
            gov_module_id,
            ctx.accounts.aeqi_governance_program.key(),
            ctx.accounts.aeqi_governance_program.key(),
            1,
            [0; 32],
            gov_acl,
        )?;

        // 3. CPI each module's init — creates the module-state PDA
        aeqi_role::cpi::init(CpiContext::new(
            ctx.accounts.aeqi_role_program.to_account_info(),
            RoleInit {
                company: ctx.accounts.company.to_account_info(),
                module_state: ctx.accounts.role_module_state.to_account_info(),
                payer: ctx.accounts.authority.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
            },
        ))?;
        aeqi_token::cpi::init(CpiContext::new(
            ctx.accounts.aeqi_token_program.to_account_info(),
            InitToken {
                company: ctx.accounts.company.to_account_info(),
                module_state: ctx.accounts.token_module_state.to_account_info(),
                payer: ctx.accounts.authority.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
            },
        ))?;
        aeqi_governance::cpi::init(CpiContext::new(
            ctx.accounts.aeqi_governance_program.to_account_info(),
            InitGovernance {
                company: ctx.accounts.company.to_account_info(),
                module_state: ctx.accounts.gov_module_state.to_account_info(),
                payer: ctx.accounts.authority.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
            },
        ))?;

        // 3a. Write the per-module config blobs to COMPANY's BytesConfig PDAs
        // before each module finalize reads them.
        let token_init_cfg = aeqi_token::TokenInitConfig {
            decimals: token_decimals,
            max_supply_cap: token_max_supply_cap,
        };
        let token_cfg_bytes = token_init_cfg.try_to_vec()?;
        aeqi_company::cpi::set_bytes_config(
            CpiContext::new(
                ctx.accounts.aeqi_company_program.to_account_info(),
                CompanySetBytesConfig {
                    company: ctx.accounts.company.to_account_info(),
                    config: ctx.accounts.token_bytes_config.to_account_info(),
                    source_module: None,
                    authority: ctx.accounts.authority.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                },
            ),
            aeqi_token::TOKEN_CONFIG_KEY,
            token_cfg_bytes,
        )?;

        // 4. finalize each module — transitions Initialized → Finalized and
        // (for those that consume config-bytes) decodes their respective
        // BytesConfig blob.
        aeqi_role::cpi::finalize(CpiContext::new(
            ctx.accounts.aeqi_role_program.to_account_info(),
            RoleFinalize {
                company: ctx.accounts.company.to_account_info(),
                module_state: ctx.accounts.role_module_state.to_account_info(),
            },
        ))?;
        aeqi_token::cpi::finalize(CpiContext::new(
            ctx.accounts.aeqi_token_program.to_account_info(),
            FinalizeToken {
                company: ctx.accounts.company.to_account_info(),
                module_state: ctx.accounts.token_module_state.to_account_info(),
                bytes_config: ctx.accounts.token_bytes_config.to_account_info(),
            },
        ))?;
        aeqi_governance::cpi::finalize(CpiContext::new(
            ctx.accounts.aeqi_governance_program.to_account_info(),
            FinalizeGovernance { company: ctx.accounts.company.to_account_info() },
        ))?;

        // 5. finalize company
        aeqi_company::cpi::finalize(CpiContext::new(
            ctx.accounts.aeqi_company_program.to_account_info(),
            CompanyFinalize {
                company: ctx.accounts.company.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
        ))?;

        emit!(CompanyFullySpawned {
            company: ctx.accounts.company.key(),
            company_id,
            authority: ctx.accounts.authority.key(),
        });
        Ok(())
    }

    /// Register a template — stores the module set, ACL graph, and admin so
    /// `instantiate_template` can later replay this against a fresh COMPANY.
    pub fn register_template(
        ctx: Context<RegisterTemplate>,
        template_id: [u8; 32],
        modules: Vec<ModuleSpec>,
        acl_edges: Vec<AclEdgeSpec>,
    ) -> Result<()> {
        require!(!modules.is_empty(), FactoryError::EmptyModuleSet);
        require!(modules.len() <= 16, FactoryError::TooManyModules);
        require!(acl_edges.len() <= 64, FactoryError::TooManyAclEdges);
        validate_template_graph(&modules, &acl_edges)?;

        let template = &mut ctx.accounts.template;
        template.template_id = template_id;
        template.admin = ctx.accounts.admin.key();
        template.modules = modules;
        template.acl_edges = acl_edges;
        template.bump = ctx.bumps.template;

        emit!(TemplateRegistered {
            template_id,
            admin: template.admin,
            module_count: template.modules.len() as u8,
            acl_edge_count: template.acl_edges.len() as u8,
        });
        Ok(())
    }

    /// Template-driven partial create flow: reads a registered Template PDA
    /// and replays its module set against a fresh COMPANY. **Leaves the company
    /// in creation mode** so the caller can run each module's `init` CPI
    /// before finalizing.
    ///
    /// `remaining_accounts` layout:
    ///
    ///   1. one Module PDA per module in template order
    ///   2. one ModuleImplementation PDA per module in template order
    ///   3. one ModuleAclEdge PDA per ACL edge in template order
    ///
    /// Steps:
    ///   1. CPI aeqi_company::initialize (creates company, enters creation mode)
    ///   2. Validate each ModuleSpec against its provider-published
    ///      ModuleImplementation PDA
    ///   3. For each ModuleSpec in template.modules: CPI register_module
    ///   4. For each AclEdgeSpec in template.acl_edges: CPI set_module_acl
    ///
    /// **Does NOT finalize.** Earlier versions called `aeqi_company::finalize`
    /// at step 5, which locked out every subsequent module init — modules
    /// require the company be in creation mode for their per-module `init`
    /// CPI to succeed. Callers that need register + per-module init +
    /// finalize MUST issue the finalize CPI themselves once all the inits
    /// have landed. Same bug class as the prior `create_with_modules`
    /// shape (fix shipped 2026-05-17 b7173c8c); applying it here closes
    /// the lookalike before templates go live in the field.
    pub fn instantiate_template<'info>(
        ctx: Context<'_, '_, 'info, 'info, InstantiateTemplate<'info>>,
        company_id: [u8; 32],
    ) -> Result<()> {
        let template = &ctx.accounts.template;
        require!(!template.modules.is_empty(), FactoryError::EmptyModuleSet);
        let expected_remaining_accounts = template.modules.len() * 2 + template.acl_edges.len();
        require!(
            ctx.remaining_accounts.len() == expected_remaining_accounts,
            FactoryError::TemplateAccountCountMismatch
        );

        let module_count = template.modules.len();
        let module_accounts = &ctx.remaining_accounts[..module_count];
        let implementation_accounts = &ctx.remaining_accounts[module_count..module_count * 2];
        let acl_edge_accounts = &ctx.remaining_accounts[module_count * 2..];

        for (spec, implementation_acct) in
            template.modules.iter().zip(implementation_accounts.iter())
        {
            validate_implementation_account(spec, implementation_acct)?;
        }

        // 1. initialize company
        let init_accounts = CompanyInitialize {
            company: ctx.accounts.company.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
        };
        let init_ctx =
            CpiContext::new(ctx.accounts.aeqi_company_program.to_account_info(), init_accounts);
        aeqi_company::cpi::initialize(init_ctx, company_id)?;

        // 2. register each module from the template's spec
        for (spec, module_acct) in template.modules.iter().zip(module_accounts.iter()) {
            let reg_accounts = CompanyRegisterModule {
                company: ctx.accounts.company.to_account_info(),
                module: module_acct.clone(),
                authority: ctx.accounts.authority.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
            };
            let reg_ctx =
                CpiContext::new(ctx.accounts.aeqi_company_program.to_account_info(), reg_accounts);
            aeqi_company::cpi::register_module(
                reg_ctx,
                spec.module_id,
                spec.program_id,
                spec.provider,
                spec.implementation_version,
                spec.implementation_metadata_hash,
                spec.company_acl,
            )?;
        }

        // 3. replay the template ACL graph.
        for (edge, acl_edge_acct) in template.acl_edges.iter().zip(acl_edge_accounts.iter()) {
            let source_index = template
                .modules
                .iter()
                .position(|module| module.module_id == edge.source_module_id)
                .ok_or(error!(FactoryError::UnknownAclModuleReference))?;
            let target_index = template
                .modules
                .iter()
                .position(|module| module.module_id == edge.target_module_id)
                .ok_or(error!(FactoryError::UnknownAclModuleReference))?;
            let source_module = module_accounts[source_index].clone();
            let target_module = module_accounts[target_index].clone();
            let acl_accounts = CompanySetModuleAcl {
                company: ctx.accounts.company.to_account_info(),
                source_module,
                target_module,
                acl_edge: acl_edge_acct.clone(),
                authority: ctx.accounts.authority.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
            };
            let acl_ctx =
                CpiContext::new(ctx.accounts.aeqi_company_program.to_account_info(), acl_accounts);
            aeqi_company::cpi::set_module_acl(acl_ctx, edge.target_module_id, edge.flags)?;
        }

        // 5. (intentionally NOT finalizing — see docstring above)

        emit!(TemplateInstantiated {
            company: ctx.accounts.company.key(),
            company_id,
            template_id: template.template_id,
            module_count: template.modules.len() as u8,
        });
        Ok(())
    }
}

fn validate_implementation_account<'info>(
    spec: &ModuleSpec,
    implementation_info: &'info AccountInfo<'info>,
) -> Result<()> {
    let expected_key = Pubkey::find_program_address(
        &[
            b"module_impl",
            spec.provider.as_ref(),
            spec.module_id.as_ref(),
            spec.implementation_version.to_le_bytes().as_ref(),
        ],
        &aeqi_company::ID,
    )
    .0;
    require_keys_eq!(
        implementation_info.key(),
        expected_key,
        FactoryError::ImplementationAccountMismatch
    );

    let implementation =
        Account::<aeqi_company::ModuleImplementation>::try_from(implementation_info)?;
    require!(implementation.active, FactoryError::InactiveImplementation);
    require_keys_eq!(
        implementation.provider,
        spec.provider,
        FactoryError::ImplementationAccountMismatch
    );
    require!(
        implementation.module_id == spec.module_id,
        FactoryError::ImplementationAccountMismatch
    );
    require_keys_eq!(
        implementation.implementation_program_id,
        spec.program_id,
        FactoryError::ImplementationAccountMismatch
    );
    require!(
        implementation.version == spec.implementation_version,
        FactoryError::ImplementationAccountMismatch
    );
    require!(
        implementation.metadata_hash == spec.implementation_metadata_hash,
        FactoryError::ImplementationAccountMismatch
    );

    Ok(())
}

fn validate_template_graph(modules: &[ModuleSpec], acl_edges: &[AclEdgeSpec]) -> Result<()> {
    for (i, module) in modules.iter().enumerate() {
        require!(module.implementation_version > 0, FactoryError::InvalidImplementationVersion);
        for prev in modules.iter().take(i) {
            require!(prev.module_id != module.module_id, FactoryError::DuplicateModuleId);
        }
    }

    for edge in acl_edges {
        let source_ok = modules.iter().any(|m| m.module_id == edge.source_module_id);
        let target_ok = modules.iter().any(|m| m.module_id == edge.target_module_id);
        require!(source_ok, FactoryError::UnknownAclModuleReference);
        require!(target_ok, FactoryError::UnknownAclModuleReference);
    }

    Ok(())
}

#[derive(Accounts)]
#[instruction(company_id: [u8; 32])]
pub struct CreateCompany<'info> {
    /// CHECK: validated structurally by aeqi_company::initialize, which derives
    /// the PDA from `[b"company", company_id]` under its own program ID.
    #[account(mut)]
    pub company: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub aeqi_company_program: Program<'info, AeqiCompany>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(template_id: [u8; 32], modules: Vec<ModuleSpec>, acl_edges: Vec<AclEdgeSpec>)]
pub struct RegisterTemplate<'info> {
    #[account(
        init,
        payer = admin,
        space = Template::space(modules.len(), acl_edges.len()),
        seeds = [b"template", template_id.as_ref()],
        bump,
    )]
    pub template: Account<'info, Template>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(company_id: [u8; 32])]
pub struct CreateWithModules<'info> {
    /// CHECK: aeqi_company::initialize derives the PDA from
    /// `[b"company", company_id]` under its own program ID.
    #[account(mut)]
    pub company: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub aeqi_company_program: Program<'info, AeqiCompany>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(
    company_id: [u8; 32],
    role_module_id: [u8; 32],
    token_module_id: [u8; 32],
    gov_module_id: [u8; 32],
)]
pub struct CreateCompanyFull<'info> {
    /// CHECK: aeqi_company::initialize derives + creates the PDA.
    #[account(mut)]
    pub company: UncheckedAccount<'info>,
    /// CHECK: aeqi_company::register_module creates this PDA.
    #[account(mut)]
    pub role_module: UncheckedAccount<'info>,
    /// CHECK: aeqi_company::register_module creates this PDA.
    #[account(mut)]
    pub token_module: UncheckedAccount<'info>,
    /// CHECK: aeqi_company::register_module creates this PDA.
    #[account(mut)]
    pub gov_module: UncheckedAccount<'info>,
    /// CHECK: aeqi_role::init creates this PDA.
    #[account(mut)]
    pub role_module_state: UncheckedAccount<'info>,
    /// CHECK: aeqi_token::init creates this PDA.
    #[account(mut)]
    pub token_module_state: UncheckedAccount<'info>,
    /// CHECK: aeqi_governance::init creates this PDA.
    #[account(mut)]
    pub gov_module_state: UncheckedAccount<'info>,
    /// CHECK: aeqi_company::set_bytes_config init_if_needed-creates the
    /// BytesConfig PDA at the canonical TOKEN_CONFIG_KEY seed under
    /// aeqi_company's program id.
    #[account(mut)]
    pub token_bytes_config: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub aeqi_company_program: Program<'info, AeqiCompany>,
    pub aeqi_role_program: Program<'info, AeqiRole>,
    pub aeqi_token_program: Program<'info, AeqiToken>,
    pub aeqi_governance_program: Program<'info, AeqiGovernance>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(company_id: [u8; 32])]
pub struct InstantiateTemplate<'info> {
    #[account(seeds = [b"template", template.template_id.as_ref()], bump = template.bump)]
    pub template: Account<'info, Template>,
    /// CHECK: aeqi_company::initialize derives the PDA from
    /// `[b"company", company_id]` under its own program ID.
    #[account(mut)]
    pub company: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub aeqi_company_program: Program<'info, AeqiCompany>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct CompanyCreated {
    pub company: Pubkey,
    pub company_id: [u8; 32],
    pub authority: Pubkey,
}

#[event]
pub struct TemplateRegistered {
    pub template_id: [u8; 32],
    pub admin: Pubkey,
    pub module_count: u8,
    pub acl_edge_count: u8,
}

#[event]
pub struct CompanyFullySpawned {
    pub company: Pubkey,
    pub company_id: [u8; 32],
    pub authority: Pubkey,
}

#[event]
pub struct TemplateInstantiated {
    pub company: Pubkey,
    pub company_id: [u8; 32],
    pub template_id: [u8; 32],
    pub module_count: u8,
}

#[event]
pub struct CompanySpawned {
    pub company: Pubkey,
    pub company_id: [u8; 32],
    pub authority: Pubkey,
    pub module_count: u8,
}

#[error_code]
pub enum FactoryError {
    #[msg("template must declare at least one module")]
    EmptyModuleSet,
    #[msg("template module set exceeds maximum (16)")]
    TooManyModules,
    #[msg("template ACL edges exceed maximum (64)")]
    TooManyAclEdges,
    #[msg("remaining_accounts.len() must equal modules.len()")]
    ModuleAccountCountMismatch,
    #[msg("remaining_accounts must include module, implementation, and ACL-edge accounts")]
    TemplateAccountCountMismatch,
    #[msg("template module ids must be unique")]
    DuplicateModuleId,
    #[msg("template ACL edge references unknown module id")]
    UnknownAclModuleReference,
    #[msg("template module implementation version must be greater than zero")]
    InvalidImplementationVersion,
    #[msg("template module implementation account does not match the module spec")]
    ImplementationAccountMismatch,
    #[msg("template module implementation is inactive")]
    InactiveImplementation,
}
