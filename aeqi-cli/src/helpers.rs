use aeqi_core::credentials::read_global_legacy_blob_sync;
use aeqi_core::traits::{Provider, Tool};
use aeqi_core::{AEQIConfig, ProviderKind};
use anyhow::{Context, Result};

/// Resolve `${ENV_VAR}` patterns in a config value. Returns empty string if
/// the value is a `${...}` pattern and the env var is not set.
fn resolve_env_value(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.starts_with("${") && trimmed.ends_with('}') {
        let var_name = &trimmed[2..trimmed.len() - 1];
        std::env::var(var_name).unwrap_or_default()
    } else {
        trimmed.to_string()
    }
}
use aeqi_ideas::SqliteIdeas;
use aeqi_providers::{
    AnthropicProvider, OllamaProvider, OpenRouterEmbedder, OpenRouterProvider, ReliableProvider,
};
use aeqi_quests::QuestBoard;
use aeqi_tools::{
    ExecutePlanTool, FileEditTool, FileReadTool, FileWriteTool, GitWorktreeTool, GlobTool,
    GrepTool, ListDirTool, PorkbunTool, SecretsTool, ShellTool,
};

use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

pub(crate) fn load_config(config_path: &Option<PathBuf>) -> Result<(AEQIConfig, PathBuf)> {
    if let Some(path) = config_path {
        Ok((AEQIConfig::load(path)?, path.clone()))
    } else {
        AEQIConfig::discover()
    }
}

/// Load config (no disk-based agent discovery — agents come from the DB).
pub(crate) fn load_config_with_agents(
    config_path: &Option<PathBuf>,
) -> Result<(AEQIConfig, PathBuf)> {
    let (mut config, path) = load_config(config_path)?;
    resolve_web_paths(&mut config, &path);
    Ok((config, path))
}

fn resolve_web_paths(config: &mut AEQIConfig, config_path: &Path) {
    let Some(ui_dist_dir) = config.web.ui_dist_dir.as_mut() else {
        return;
    };

    let path = PathBuf::from(ui_dist_dir.as_str());
    if path.is_absolute() {
        return;
    }

    if let Some(parent) = config_path.parent() {
        *ui_dist_dir = parent.join(path).to_string_lossy().into_owned();
    }
}

pub(crate) fn find_project_dir(name: &str) -> Result<PathBuf> {
    find_named_dir("projects", name, None, None)
}

pub(crate) fn find_agent_dir(name: &str) -> Result<PathBuf> {
    find_named_dir("agents", name, None, None)
}

/// Like `find_agent_dir`, but anchors lookup at the discovered config
/// file and resolved data dir as well as walking parents of cwd. Use
/// this from `aeqi doctor` and similar commands so a clean
/// `aeqi setup -> aeqi doctor` from any cwd resolves agents written to
/// `~/.aeqi/agents/<name>`.
pub(crate) fn find_agent_dir_for_config(
    name: &str,
    config_path: &Path,
    data_dir: &Path,
) -> Result<PathBuf> {
    find_named_dir("agents", name, Some(config_path), Some(data_dir))
}

pub(crate) fn find_project_dir_for_config(
    name: &str,
    config_path: &Path,
    data_dir: &Path,
) -> Result<PathBuf> {
    find_named_dir("projects", name, Some(config_path), Some(data_dir))
}

fn find_named_dir(
    kind: &str,
    name: &str,
    config_path: Option<&Path>,
    data_dir: Option<&Path>,
) -> Result<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::with_capacity(8);

    // Anchored lookups: config file's parent (covers `~/.aeqi/aeqi.toml` →
    // `~/.aeqi/agents/<name>`) and the parent's parent (covers
    // `<workspace>/config/aeqi.toml` → `<workspace>/agents/<name>`).
    if let Some(cfg) = config_path
        && let Some(parent) = cfg.parent()
    {
        candidates.push(parent.join(kind).join(name));
        if let Some(grand) = parent.parent() {
            candidates.push(grand.join(kind).join(name));
        }
    }

    // Anchored at the resolved data_dir (typically ~/.aeqi).
    if let Some(d) = data_dir {
        candidates.push(d.join(kind).join(name));
    }

    // Cwd-relative shortcuts retained for back-compat.
    candidates.push(PathBuf::from(format!("{kind}/{name}")));
    candidates.push(PathBuf::from(format!("../{kind}/{name}")));

    for c in &candidates {
        if c.exists() {
            return Ok(c.clone());
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        let mut dir = cwd.as_path();
        loop {
            let candidate = dir.join(kind).join(name);
            if candidate.exists() {
                return Ok(candidate);
            }
            match dir.parent() {
                Some(p) => dir = p,
                None => break,
            }
        }
    }
    anyhow::bail!("{kind} directory not found: {name}")
}

pub(crate) fn get_api_key(config: &AEQIConfig) -> Result<String> {
    let or_config = config
        .providers
        .openrouter
        .as_ref()
        .context("no OpenRouter provider configured")?;
    // Resolve ${ENV_VAR} patterns, then fall back to the credentials
    // substrate. SecretStore filesystem is no longer consulted — Move A
    // migrated and purged it.
    let key = resolve_env_value(&or_config.api_key);
    if !key.is_empty() {
        return Ok(key);
    }
    if let Some(value) = read_global_legacy_blob_sync(&config.data_dir(), "OPENROUTER_API_KEY")
        .context("read OPENROUTER_API_KEY from credentials substrate")?
        .filter(|v| !v.is_empty())
    {
        return Ok(value);
    }
    anyhow::bail!("OPENROUTER_API_KEY not set. Use `aeqi secrets set OPENROUTER_API_KEY <key>`");
}

fn is_proxy_api_key(value: &str) -> bool {
    value.trim().eq_ignore_ascii_case("proxy")
}

fn openrouter_embedding_api_key(config: &AEQIConfig) -> Result<Option<String>> {
    let Some(or_config) = config.providers.openrouter.as_ref() else {
        return Ok(None);
    };

    let configured = resolve_env_value(&or_config.api_key);
    if !configured.is_empty() && !is_proxy_api_key(&configured) {
        return Ok(Some(configured));
    }

    let substrate_key = read_global_legacy_blob_sync(&config.data_dir(), "OPENROUTER_API_KEY")
        .context("read OPENROUTER_API_KEY from credentials substrate")?;
    if let Some(value) = substrate_key.filter(|v| !v.is_empty() && !is_proxy_api_key(v)) {
        return Ok(Some(value));
    }

    Ok(None)
}

pub(crate) fn provider_secret_store_path(config: &AEQIConfig) -> PathBuf {
    config
        .security
        .secret_store
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or_else(|| config.data_dir().join("secrets"))
}

/// Re-resolve provider API keys against the credentials substrate. Used after
/// the daemon's startup migration runs — `parse()` already tried to fill
/// `config.providers.*.api_key` from the substrate, but on the first boot the
/// substrate was empty (SecretStore was still on disk). After migration
/// finishes, the keys live in the substrate and we re-fill any empties.
pub(crate) fn refresh_provider_keys_from_substrate(config: &mut AEQIConfig) {
    let data_dir = config.data_dir();
    if let Some(ref mut or) = config.providers.openrouter
        && or.api_key.is_empty()
        && let Ok(Some(value)) = read_global_legacy_blob_sync(&data_dir, "OPENROUTER_API_KEY")
        && !value.is_empty()
    {
        or.api_key = value;
    }
    if let Some(ref mut a) = config.providers.anthropic
        && a.api_key.is_empty()
        && let Ok(Some(value)) = read_global_legacy_blob_sync(&data_dir, "ANTHROPIC_API_KEY")
        && !value.is_empty()
    {
        a.api_key = value;
    }
}

fn get_anthropic_api_key(config: &AEQIConfig) -> Result<String> {
    let anthropic = config
        .providers
        .anthropic
        .as_ref()
        .context("no Anthropic provider configured")?;
    let key = resolve_env_value(&anthropic.api_key);
    if !key.is_empty() {
        return Ok(key);
    }
    if let Some(value) = read_global_legacy_blob_sync(&config.data_dir(), "ANTHROPIC_API_KEY")
        .context("read ANTHROPIC_API_KEY from credentials substrate")?
        .filter(|v| !v.is_empty())
    {
        return Ok(value);
    }
    anyhow::bail!("ANTHROPIC_API_KEY not set. Use `aeqi secrets set ANTHROPIC_API_KEY <key>`");
}

/// Build a single concrete provider for the given kind, using the supplied
/// model. Returns an error if the provider isn't configured or the API key
/// is missing. Used as the building block for the failover-wrapped runtime
/// provider.
fn build_single_provider(
    config: &AEQIConfig,
    provider_kind: ProviderKind,
    model: String,
) -> Result<Arc<dyn Provider>> {
    match provider_kind {
        ProviderKind::OpenRouter => {
            let api_key = get_api_key(config)?;
            let mut provider = OpenRouterProvider::new(api_key, model)?;
            if let Some(ref or_cfg) = config.providers.openrouter
                && let Some(ref url) = or_cfg.base_url
            {
                provider = provider.with_base_url(url.clone());
            }
            Ok(Arc::new(provider))
        }
        ProviderKind::Anthropic => {
            let api_key = get_anthropic_api_key(config)?;
            Ok(Arc::new(AnthropicProvider::new(api_key, model)?))
        }
        ProviderKind::Ollama => {
            let ollama = config.providers.ollama.as_ref();
            let url = ollama
                .map(|cfg| cfg.url.clone())
                .unwrap_or_else(|| "http://localhost:11434".to_string());
            Ok(Arc::new(OllamaProvider::new(url, model)?))
        }
    }
}

/// Opportunistically build a secondary cloud provider to serve as a
/// failover for `primary_kind`. Returns `None` when no suitable secondary
/// is configured (missing config block, empty API key, or local-only
/// primary). Ollama is intentionally never auto-paired — it's a local
/// dev provider and pairing it with a remote primary would silently
/// downgrade a request on a transient remote blip.
fn build_secondary_provider(
    config: &AEQIConfig,
    primary_kind: ProviderKind,
) -> Option<Arc<dyn Provider>> {
    let secondary_kind = match primary_kind {
        // Per the 2026-05-17 + 2026-05-18 outage class (OpenRouter
        // weekly cap exhausted), the canonical cloud-to-cloud failover
        // is OpenRouter <-> Anthropic.
        ProviderKind::OpenRouter => ProviderKind::Anthropic,
        ProviderKind::Anthropic => ProviderKind::OpenRouter,
        // Local primary: no remote secondary auto-wired. The caller
        // explicitly chose local and likely expects it to either succeed
        // or fail locally rather than silently leaking traffic to a
        // cloud provider.
        ProviderKind::Ollama => return None,
    };

    let model = config.default_model_for_provider(secondary_kind);
    match build_single_provider(config, secondary_kind, model) {
        Ok(provider) => Some(provider),
        Err(err) => {
            tracing::debug!(
                secondary = ?secondary_kind,
                error = %err,
                "no secondary provider available for failover; primary only"
            );
            None
        }
    }
}

pub(crate) fn build_provider_for_runtime(
    config: &AEQIConfig,
    provider_kind: ProviderKind,
    model_override: Option<&str>,
) -> Result<Arc<dyn Provider>> {
    let model = model_override
        .filter(|m| !m.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| config.default_model_for_provider(provider_kind));

    let primary = build_single_provider(config, provider_kind, model)?;

    // Wrap the primary in ReliableProvider for retry + circuit-break
    // behaviour even when only one provider is configured. When a
    // sibling cloud provider is available, add it as a secondary so a
    // primary outage (cap-exhaust, 401, network blip) fails over
    // instead of dropping the request.
    let mut providers: Vec<Arc<dyn Provider>> = Vec::with_capacity(2);
    providers.push(primary);
    if let Some(secondary) = build_secondary_provider(config, provider_kind) {
        tracing::info!(
            primary = ?provider_kind,
            "runtime provider built with failover secondary"
        );
        providers.push(secondary);
    }
    Ok(Arc::new(ReliableProvider::new(providers)))
}

pub(crate) fn one_shot_agent_name(config: &AEQIConfig, _project_name: Option<&str>) -> String {
    config
        .default_agent()
        .map(|agent| agent.name.clone())
        .unwrap_or_default()
}

pub(crate) fn build_provider_for_one_shot(
    config: &AEQIConfig,
    project_name: Option<&str>,
) -> Result<Arc<dyn Provider>> {
    if let Some(project_name) = project_name {
        build_provider_for_project(config, project_name)
    } else {
        let agent_name = one_shot_agent_name(config, None);
        build_provider_for_agent(config, &agent_name)
    }
}

pub(crate) fn build_provider_for_project(
    config: &AEQIConfig,
    project_name: &str,
) -> Result<Arc<dyn Provider>> {
    let runtime = config.runtime_for_project(project_name);
    let model = config.model_for_project(project_name);
    build_provider_for_runtime(config, runtime.provider, Some(&model))
}

pub(crate) fn build_provider_for_agent(
    config: &AEQIConfig,
    agent_name: &str,
) -> Result<Arc<dyn Provider>> {
    let runtime = config.runtime_for_agent(agent_name);
    let model = config.model_for_agent(agent_name);
    build_provider_for_runtime(config, runtime.provider, Some(&model))
}

pub(crate) fn build_tools(workdir: &Path) -> Vec<Arc<dyn Tool>> {
    let mut tools: Vec<Arc<dyn Tool>> = vec![
        Arc::new(ShellTool::new(workdir.to_path_buf())),
        Arc::new(FileReadTool::new(workdir.to_path_buf())),
        Arc::new(FileWriteTool::new(workdir.to_path_buf())),
        Arc::new(FileEditTool::new(workdir.to_path_buf())),
        Arc::new(ListDirTool::new(workdir.to_path_buf())),
        Arc::new(GrepTool::new(workdir.to_path_buf())),
        Arc::new(GlobTool::new(workdir.to_path_buf())),
    ];

    // Execute plan — batch multiple tool calls in one step (context compression).
    tools.push(Arc::new(ExecutePlanTool::new(tools.clone())));

    // Secrets management — encrypted credential store.
    let secrets_path = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join(".aeqi")
        .join("secrets");
    tools.push(Arc::new(SecretsTool::new(secrets_path)));

    tools
}

/// Build the full tool set for a project: basic tools + git worktree.
pub(crate) fn build_project_tools(
    workdir: &Path,
    worktree_root: Option<&PathBuf>,
) -> Vec<Arc<dyn Tool>> {
    let mut tools: Vec<Arc<dyn Tool>> = vec![
        Arc::new(ShellTool::new(workdir.to_path_buf())),
        Arc::new(FileReadTool::new(workdir.to_path_buf())),
        Arc::new(FileWriteTool::new(workdir.to_path_buf())),
        Arc::new(FileEditTool::new(workdir.to_path_buf())),
        Arc::new(ListDirTool::new(workdir.to_path_buf())),
        Arc::new(GrepTool::new(workdir.to_path_buf())),
        Arc::new(GlobTool::new(workdir.to_path_buf())),
    ];

    // Add git worktree tool.
    let wt_root = worktree_root
        .cloned()
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join("worktrees"));
    tools.push(Arc::new(GitWorktreeTool::new(
        workdir.to_path_buf(),
        wt_root,
    )));

    // Add Porkbun domain tool if credentials are available.
    if let Some(porkbun) = PorkbunTool::from_env() {
        tools.push(Arc::new(porkbun));
    }

    tools
}

/// Look up project name from a quest prefix (e.g. "as" -> "test-project").
pub(crate) fn project_name_for_prefix(config: &AEQIConfig, prefix: &str) -> Option<String> {
    // Check agent prefixes.
    for agent in &config.agents {
        if agent.prefix == prefix {
            return Some(agent.name.clone());
        }
    }
    config
        .agent_spawns
        .iter()
        .find(|r| r.prefix == prefix)
        .map(|r| r.name.clone())
}

pub(crate) fn open_quests_for_project(project_name: &str) -> Result<QuestBoard> {
    let owner_dir = find_project_dir(project_name).or_else(|_| find_agent_dir(project_name))?;
    let quests_dir = owner_dir.join(".quests");
    QuestBoard::open(&quests_dir)
}

pub(crate) fn open_ideas(config: &AEQIConfig) -> Result<SqliteIdeas> {
    let (ideas, _) = open_ideas_with_embedder(config)?;
    Ok(ideas)
}

/// Like `open_ideas` but also returns the embedder so the daemon can
/// reuse it for query-time embedding / the async embed worker. Returns
/// `None` when no API key is configured — the search path falls back to
/// BM25-only.
pub(crate) fn open_ideas_with_embedder(
    config: &AEQIConfig,
) -> Result<(SqliteIdeas, Option<Arc<dyn aeqi_core::traits::Embedder>>)> {
    // Ideas live in aeqi.db — the single source of truth.
    let db_path = config.data_dir().join("aeqi.db");
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let halflife = config.ideas.temporal_decay_halflife_days;
    let mem = SqliteIdeas::open(&db_path, halflife)?;

    let api_key = openrouter_embedding_api_key(config)?;
    let embedding_model = config
        .providers
        .openrouter
        .as_ref()
        .and_then(|or| or.embedding_model.clone())
        .or_else(|| {
            // Default to a cheap, high-quality model when OpenRouter is configured
            // but no explicit embedding_model is set.
            api_key
                .as_ref()
                .map(|_| "openai/text-embedding-3-small".to_string())
        });

    if let (Some(key), Some(model)) = (api_key, embedding_model) {
        tracing::info!(model = %model, "idea vector search enabled");
        let embedder: Arc<dyn aeqi_core::traits::Embedder> = Arc::new(OpenRouterEmbedder::new(
            key,
            model,
            config.ideas.embedding_dimensions,
        ));
        let mem = mem.with_embedder(
            embedder.clone(),
            config.ideas.embedding_dimensions,
            config.ideas.vector_weight,
            config.ideas.keyword_weight,
            config.ideas.mmr_lambda,
        )?;
        Ok((mem, Some(embedder)))
    } else {
        tracing::info!(
            "idea vector search disabled (no public OpenRouter embedding API key); using keyword search only"
        );
        Ok((mem, None))
    }
}

pub(crate) fn format_project_org_hint(_config: &AEQIConfig, _project_name: &str) -> String {
    String::new()
}

pub(crate) fn format_agent_org_hint(_config: &AEQIConfig, _agent_name: &str) -> String {
    String::new()
}

/// Append org context to a system prompt string.
pub(crate) fn augment_prompt_with_org_context(config: &AEQIConfig, prompt: &str) -> String {
    let name = &config.aeqi.name;
    let section = format!("# Team Context\n\nSystem: {name}");
    if prompt.is_empty() || prompt == "You are a helpful AI agent." {
        section
    } else {
        format!("{prompt}\n\n---\n\n{section}")
    }
}

/// Resolve the agents/ directory relative to config file path.
pub(crate) fn resolve_agents_dir(config_path: &Path) -> PathBuf {
    // Config is typically at config/aeqi.toml, so agents/ is at config/../agents
    if let Some(parent) = config_path.parent() {
        let candidate = parent.join("../agents");
        if candidate.exists() {
            return candidate;
        }
        // Try parent's parent (if config is nested deeper)
        if let Some(grandparent) = parent.parent() {
            let candidate = grandparent.join("agents");
            if candidate.exists() {
                return candidate;
            }
        }
    }
    // Fallback: look from cwd
    PathBuf::from("agents")
}

pub(crate) fn pid_file_path(config: &AEQIConfig) -> PathBuf {
    config.data_dir().join("rm.pid")
}

pub(crate) async fn daemon_ipc_request(
    config_path: &Option<PathBuf>,
    request: &serde_json::Value,
) -> Result<serde_json::Value> {
    let (config, _) = load_config(config_path)?;
    let socket_path = config.data_dir().join("rm.sock");

    if !socket_path.exists() {
        anyhow::bail!(
            "IPC socket not found: {}. Is the daemon running?",
            socket_path.display()
        );
    }

    #[cfg(unix)]
    {
        let stream = tokio::net::UnixStream::connect(&socket_path)
            .await
            .with_context(|| {
                format!("failed to connect to IPC socket: {}", socket_path.display())
            })?;

        let (reader, mut writer) = stream.into_split();
        let mut req_bytes = serde_json::to_vec(request)?;
        req_bytes.push(b'\n');
        writer.write_all(&req_bytes).await?;

        let mut lines = BufReader::new(reader).lines();
        let Some(line) = lines.next_line().await? else {
            anyhow::bail!(
                "IPC socket closed without a response: {}",
                socket_path.display()
            );
        };

        let response: serde_json::Value = serde_json::from_str(&line)?;
        Ok(response)
    }
    #[cfg(not(unix))]
    {
        let _ = request;
        anyhow::bail!("IPC socket queries not supported on this platform");
    }
}

#[cfg(test)]
mod tests {
    use super::is_proxy_api_key;

    #[test]
    fn proxy_api_key_detection_is_case_and_space_insensitive() {
        assert!(is_proxy_api_key("proxy"));
        assert!(is_proxy_api_key(" Proxy "));
        assert!(!is_proxy_api_key("sk-or-real"));
        assert!(!is_proxy_api_key(""));
    }
}
