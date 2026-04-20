//! Communication channel implementations for the `Channel` trait.
//!
//! Pure-Rust channels (Telegram, Discord, Slack, Twilio WhatsApp) talk
//! directly to their provider APIs. For protocols where a Rust client
//! would mean re-implementing a reverse-engineered stack — Baileys
//! (WhatsApp Web), iLink (personal Weixin) — the `bridge` module spawns a
//! side-process and speaks JSON-lines over stdio.

pub mod bridge;
pub mod discord;
pub mod slack;
pub mod telegram;
pub mod whatsapp;
pub mod whatsapp_baileys;

pub use bridge::{BridgeClient, BridgeEvent};
pub use discord::DiscordChannel;
pub use slack::SlackChannel;
pub use telegram::{TelegramChannel, TelegramGateway};
pub use whatsapp::WhatsAppChannel;
pub use whatsapp_baileys::{
    BaileysState, BaileysStatus, StatusHandle, WhatsAppBaileysChannel, WhatsappBaileysGateway,
};
