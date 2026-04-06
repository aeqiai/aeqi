//! Skin/theme system — data-driven TUI visual customization.
//!
//! Each agent can have a theme override. Themes are YAML files in
//! ~/.aeqi/themes/ or embedded defaults.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// A complete TUI theme definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Theme {
    /// Theme name.
    pub name: String,
    /// Description.
    #[serde(default)]
    pub description: String,
    /// Color palette.
    #[serde(default)]
    pub colors: ThemeColors,
    /// Spinner configuration.
    #[serde(default)]
    pub spinner: SpinnerConfig,
    /// Branding text.
    #[serde(default)]
    pub branding: BrandingConfig,
    /// Per-tool emoji overrides.
    #[serde(default)]
    pub tool_emojis: HashMap<String, String>,
    /// Tool output prefix character.
    #[serde(default = "default_tool_prefix")]
    pub tool_prefix: String,
}

fn default_tool_prefix() -> String {
    "┊".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeColors {
    /// Response box border color (hex).
    #[serde(default = "default_gold")]
    pub response_border: String,
    /// Status bar background (hex).
    #[serde(default = "default_dark")]
    pub status_bg: String,
    /// Prompt symbol color (hex).
    #[serde(default = "default_gold")]
    pub prompt: String,
    /// Agent name color override (hex). If empty, uses agent's own color.
    #[serde(default)]
    pub agent_name: String,
    /// System message color.
    #[serde(default = "default_dim")]
    pub system: String,
    /// Error color.
    #[serde(default = "default_red")]
    pub error: String,
    /// User message color.
    #[serde(default = "default_cyan")]
    pub user: String,
}

impl Default for ThemeColors {
    fn default() -> Self {
        Self {
            response_border: default_gold(),
            status_bg: default_dark(),
            prompt: default_gold(),
            agent_name: String::new(),
            system: default_dim(),
            error: default_red(),
            user: default_cyan(),
        }
    }
}

fn default_gold() -> String {
    "#FFD700".into()
}
fn default_dark() -> String {
    "#191919".into()
}
fn default_dim() -> String {
    "#808080".into()
}
fn default_red() -> String {
    "#FF4444".into()
}
fn default_cyan() -> String {
    "#00CED1".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpinnerConfig {
    /// Spinner frames for animation.
    #[serde(default = "default_spinner_frames")]
    pub frames: Vec<String>,
    /// Thinking verbs shown during API calls.
    #[serde(default = "default_thinking_verbs")]
    pub thinking_verbs: Vec<String>,
}

impl Default for SpinnerConfig {
    fn default() -> Self {
        Self {
            frames: default_spinner_frames(),
            thinking_verbs: default_thinking_verbs(),
        }
    }
}

fn default_spinner_frames() -> Vec<String> {
    vec!["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
        .into_iter()
        .map(String::from)
        .collect()
}

fn default_thinking_verbs() -> Vec<String> {
    vec![
        "thinking",
        "pondering",
        "considering",
        "analyzing",
        "reasoning",
    ]
    .into_iter()
    .map(String::from)
    .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrandingConfig {
    /// Welcome message on startup.
    #[serde(default = "default_welcome")]
    pub welcome: String,
    /// Goodbye message on exit.
    #[serde(default = "default_goodbye")]
    pub goodbye: String,
    /// Prompt symbol.
    #[serde(default = "default_prompt_symbol")]
    pub prompt_symbol: String,
}

impl Default for BrandingConfig {
    fn default() -> Self {
        Self {
            welcome: default_welcome(),
            goodbye: default_goodbye(),
            prompt_symbol: default_prompt_symbol(),
        }
    }
}

fn default_welcome() -> String {
    "type /help for commands, /exit to quit".into()
}
fn default_goodbye() -> String {
    "goodbye".into()
}
fn default_prompt_symbol() -> String {
    "❯".into()
}

impl Theme {
    /// Default theme (gold/warm).
    pub fn default_theme() -> Self {
        Self {
            name: "default".into(),
            description: "Classic AEQI gold theme".into(),
            colors: ThemeColors::default(),
            spinner: SpinnerConfig::default(),
            branding: BrandingConfig::default(),
            tool_emojis: HashMap::new(),
            tool_prefix: default_tool_prefix(),
        }
    }

    /// Crimson theme (for warrior/adversarial agents).
    pub fn crimson() -> Self {
        Self {
            name: "crimson".into(),
            description: "Dark crimson war theme".into(),
            colors: ThemeColors {
                response_border: "#DC143C".into(),
                prompt: "#DC143C".into(),
                ..ThemeColors::default()
            },
            spinner: SpinnerConfig {
                frames: vec!["⟪", "⟫", "⟪", "⟫", "⟪", "⟫"]
                    .into_iter()
                    .map(String::from)
                    .collect(),
                ..SpinnerConfig::default()
            },
            branding: BrandingConfig {
                prompt_symbol: "⚔".into(),
                ..BrandingConfig::default()
            },
            tool_emojis: HashMap::new(),
            tool_prefix: "│".into(),
        }
    }

    /// Mono theme (clean, minimal).
    pub fn mono() -> Self {
        Self {
            name: "mono".into(),
            description: "Clean grayscale monochrome".into(),
            colors: ThemeColors {
                response_border: "#AAAAAA".into(),
                prompt: "#FFFFFF".into(),
                user: "#CCCCCC".into(),
                ..ThemeColors::default()
            },
            spinner: SpinnerConfig::default(),
            branding: BrandingConfig {
                prompt_symbol: ">".into(),
                ..BrandingConfig::default()
            },
            tool_emojis: HashMap::new(),
            tool_prefix: "|".into(),
        }
    }

    /// Load a theme from a TOML file.
    pub fn load(path: &Path) -> Result<Self, String> {
        let content =
            std::fs::read_to_string(path).map_err(|e| format!("failed to read theme: {e}"))?;
        toml::from_str(&content).map_err(|e| format!("failed to parse theme: {e}"))
    }

    /// Get a built-in theme by name.
    pub fn builtin(name: &str) -> Option<Self> {
        match name {
            "default" => Some(Self::default_theme()),
            "crimson" | "ares" => Some(Self::crimson()),
            "mono" | "monochrome" => Some(Self::mono()),
            _ => None,
        }
    }

    /// Parse a hex color string to RGB tuple.
    pub fn parse_color(hex: &str) -> (u8, u8, u8) {
        let hex = hex.trim_start_matches('#');
        if hex.len() == 6 {
            let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(200);
            let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(200);
            let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(200);
            (r, g, b)
        } else {
            (200, 200, 200)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_theme() {
        let theme = Theme::default_theme();
        assert_eq!(theme.name, "default");
        assert_eq!(theme.tool_prefix, "┊");
    }

    #[test]
    fn test_builtin_themes() {
        assert!(Theme::builtin("default").is_some());
        assert!(Theme::builtin("crimson").is_some());
        assert!(Theme::builtin("mono").is_some());
        assert!(Theme::builtin("nonexistent").is_none());
    }

    #[test]
    fn test_parse_color() {
        assert_eq!(Theme::parse_color("#FFD700"), (255, 215, 0));
        assert_eq!(Theme::parse_color("#DC143C"), (220, 20, 60));
        assert_eq!(Theme::parse_color("invalid"), (200, 200, 200));
    }

    #[test]
    fn test_crimson_theme() {
        let theme = Theme::crimson();
        assert_eq!(theme.branding.prompt_symbol, "⚔");
    }
}
