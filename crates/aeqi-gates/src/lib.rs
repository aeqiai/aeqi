//! Communication channel implementations for the `Channel` trait.
//!
//! Provides Telegram ([`TelegramChannel`]), Discord ([`DiscordChannel`]),
//! and Slack ([`SlackChannel`]) integrations for agent-to-human messaging,
//! escalation notifications, and interactive command handling.

pub mod discord;
pub mod slack;
pub mod telegram;

pub use discord::DiscordChannel;
pub use slack::SlackChannel;
pub use telegram::TelegramChannel;
