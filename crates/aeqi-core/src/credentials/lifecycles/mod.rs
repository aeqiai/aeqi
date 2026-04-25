//! Built-in credential lifecycle plugins.

pub mod device_session;
pub mod github_app;
pub mod oauth2;
pub mod service_account;
pub mod static_secret;

pub use device_session::DeviceSessionLifecycle;
pub use github_app::GithubAppLifecycle;
pub use oauth2::{OAuth2Lifecycle, OAuth2ProviderConfig, StoredTokens as OAuth2Tokens};
pub use service_account::ServiceAccountLifecycle;
pub use static_secret::StaticSecretLifecycle;
