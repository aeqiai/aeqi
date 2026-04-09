mod agents;
pub mod auth;
mod chat;
mod companies;
mod dashboard;
mod helpers;
mod hosting;
mod memory;
mod prompts;
mod quests;
mod sessions;
mod vfs;
mod webhooks;

use crate::server::AppState;
use axum::Router;

/// Build the public webhook route (no auth required).
pub fn webhook_routes() -> Router<AppState> {
    webhooks::routes()
}

/// Build protected API routes (auth required).
pub fn api_routes() -> Router<AppState> {
    Router::new()
        .merge(dashboard::routes())
        .merge(companies::routes())
        .merge(quests::routes())
        .merge(agents::routes())
        .merge(sessions::routes())
        .merge(chat::routes())
        .merge(memory::routes())
        .merge(prompts::routes())
        .merge(vfs::routes())
        .merge(hosting::routes())
}
