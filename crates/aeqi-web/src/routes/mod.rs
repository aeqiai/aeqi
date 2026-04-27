mod agents;
pub mod auth;
mod channels;
mod chat;
mod dashboard;
mod entities;
mod events;
mod files;
mod helpers;
mod hosting;
mod ideas;
mod inbox;
pub mod integrations;
mod models;
mod quests;
mod sessions;
mod templates;
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
        .merge(entities::routes())
        .merge(quests::routes())
        .merge(agents::routes())
        .merge(sessions::routes())
        .merge(chat::routes())
        .merge(ideas::routes())
        .merge(events::routes())
        .merge(files::routes())
        .merge(channels::routes())
        .merge(inbox::routes())
        .merge(vfs::routes())
        .merge(hosting::routes())
        .merge(models::routes())
        .merge(templates::routes())
        .merge(integrations::routes())
}
