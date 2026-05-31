use anchor_lang::prelude::*;

#[error_code]
pub enum AeqiCompanyError {
    #[msg("caller is not authorized for this company")]
    Unauthorized,
    #[msg("denied — caller does not hold the required ACL flag")]
    DeniedAccess,
    #[msg("company is paused")]
    CompanyPaused,
    #[msg("operation is only permitted in creation mode")]
    NotInCreationMode,
    #[msg("company has already been finalized")]
    AlreadyFinalized,
    #[msg("company must be finalized before adopting module implementations")]
    CompanyNotFinalized,
    #[msg("company must register at least one module before finalization")]
    NoModulesRegistered,
    #[msg("module implementation version must be greater than zero")]
    InvalidImplementationVersion,
    #[msg("module implementation program account must be executable")]
    ImplementationProgramNotExecutable,
    #[msg("module implementation is inactive")]
    InactiveImplementation,
    #[msg("module implementation does not match the module slot")]
    ImplementationModuleMismatch,
    #[msg("ACL source module does not belong to this company")]
    AclSourceModuleMismatch,
    #[msg("ACL target module does not belong to this company")]
    AclTargetModuleMismatch,
    #[msg("module has already been initialized")]
    ModuleAlreadyInitialized,
    #[msg("module has not yet been initialized")]
    ModuleNotInitialized,
    #[msg("config payload exceeds maximum size")]
    ConfigTooLarge,
    #[msg("math overflow")]
    MathOverflow,
}
