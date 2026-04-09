mod helpers;
mod agents;
pub mod auth;
mod chat;
mod companies;
mod dashboard;
mod hosting;
mod memory;
mod quests;
mod sessions;
mod vfs;
mod webhooks;

use axum::Router;
use crate::server::AppState;

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
        .merge(vfs::routes())
        .merge(hosting::routes())
}
