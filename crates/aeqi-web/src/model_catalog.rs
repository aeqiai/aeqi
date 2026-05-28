use aeqi_core::config::AEQIConfig;

pub const HOSTED_DEEPSEEK_MODEL_IDS: &[&str] =
    &["deepseek/deepseek-v4-flash", "deepseek/deepseek-v4-pro"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelCatalogPolicy {
    pub model_ids: Option<Vec<&'static str>>,
    pub allow_custom: bool,
    pub scope: &'static str,
}

impl Default for ModelCatalogPolicy {
    fn default() -> Self {
        Self {
            model_ids: None,
            allow_custom: true,
            scope: "provider_agnostic",
        }
    }
}

pub fn policy_for_config(config: &AEQIConfig) -> ModelCatalogPolicy {
    let Some(openrouter) = config.providers.openrouter.as_ref() else {
        return ModelCatalogPolicy::default();
    };

    if is_platform_tenant_proxy(openrouter.base_url.as_deref())
        && is_deepseek_model(&openrouter.default_model)
    {
        return ModelCatalogPolicy {
            model_ids: Some(HOSTED_DEEPSEEK_MODEL_IDS.to_vec()),
            allow_custom: false,
            scope: "hosted_deepseek",
        };
    }

    ModelCatalogPolicy::default()
}

fn is_platform_tenant_proxy(base_url: Option<&str>) -> bool {
    base_url
        .map(|url| url.contains("/api/llm/v1/tenants/"))
        .unwrap_or(false)
}

fn is_deepseek_model(model: &str) -> bool {
    matches!(model, "deepseek-v4-flash" | "deepseek-v4-pro") || model.starts_with("deepseek/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use aeqi_core::config::AEQIConfig;

    fn config_with_openrouter(default_model: &str, base_url: Option<&str>) -> AEQIConfig {
        let base_url = base_url
            .map(|url| format!("base_url = \"{url}\""))
            .unwrap_or_default();
        let toml = format!(
            r#"
[aeqi]
name = "test"

[providers.openrouter]
api_key = "proxy"
default_model = "{default_model}"
{base_url}
"#
        );
        AEQIConfig::parse(&toml).expect("test config must parse")
    }

    #[test]
    fn hosted_deepseek_proxy_limits_catalog_to_flash_and_pro() {
        let config = config_with_openrouter(
            "deepseek/deepseek-v3.2",
            Some("http://127.0.0.1:8443/api/llm/v1/tenants/trust-id"),
        );

        let policy = policy_for_config(&config);

        assert_eq!(policy.scope, "hosted_deepseek");
        assert!(!policy.allow_custom);
        assert_eq!(policy.model_ids.as_deref(), Some(HOSTED_DEEPSEEK_MODEL_IDS));
    }

    #[test]
    fn non_platform_openrouter_keeps_provider_agnostic_catalog() {
        let config = config_with_openrouter(
            "z-ai/glm-4.5-air:free",
            Some("https://openrouter.ai/api/v1"),
        );

        let policy = policy_for_config(&config);

        assert_eq!(policy, ModelCatalogPolicy::default());
    }

    #[test]
    fn platform_proxy_with_non_deepseek_default_keeps_catalog_open() {
        let config = config_with_openrouter(
            "anthropic/claude-sonnet-4.6",
            Some("http://127.0.0.1:8443/api/llm/v1/tenants/trust-id"),
        );

        let policy = policy_for_config(&config);

        assert_eq!(policy, ModelCatalogPolicy::default());
    }
}
