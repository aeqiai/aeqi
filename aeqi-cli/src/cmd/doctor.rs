use aeqi_core::SecretStore;
use aeqi_core::credentials::{
    CredentialCipher, CredentialReasonCode, CredentialResolver, CredentialRow, CredentialStore,
    lifecycles::{
        DeviceSessionLifecycle, GithubAppLifecycle, OAuth2Lifecycle, ServiceAccountLifecycle,
        StaticSecretLifecycle,
    },
};
use aeqi_tools::Prompt;
use anyhow::{Result, bail};
use chrono::Utc;
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::helpers::{
    build_provider_for_runtime, find_agent_dir_for_config, find_project_dir_for_config,
    load_config_with_agents, provider_secret_store_path,
};

/// Severity buckets so doctor can distinguish "your install is broken"
/// from "you haven't finished setup yet" from "this dependency wasn't
/// reachable but it's optional." `--strict` fails on Blocking only —
/// NeedsAction is loud but doesn't gate CI/scripts.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Severity {
    /// Structural breakage — schema invalid, files the system requires
    /// are missing, secret store unwritable. Fails `--strict`.
    Blocking,
    /// Expected during normal first-time setup — provider API key not
    /// yet entered, etc. The user knows the next step; we just remind
    /// them. Does NOT fail `--strict`.
    NeedsAction,
    /// Environmental / optional — local Ollama not running on a fresh
    /// box, sqlite-vec module not loaded, repo path that doesn't yet
    /// exist on this machine. Informational; never fails strict.
    Optional,
}

impl Severity {
    fn tag(self) -> &'static str {
        match self {
            Severity::Blocking => "[BLOCK]",
            Severity::NeedsAction => "[NEEDS]",
            Severity::Optional => "[OPT]",
        }
    }
}

#[derive(Default)]
struct Tally {
    blocking: u32,
    needs_action: u32,
    optional: u32,
    fixed: u32,
}

impl Tally {
    fn report(&mut self, severity: Severity, msg: impl AsRef<str>) {
        match severity {
            Severity::Blocking => self.blocking += 1,
            Severity::NeedsAction => self.needs_action += 1,
            Severity::Optional => self.optional += 1,
        }
        println!("{} {}", severity.tag(), msg.as_ref());
    }

    fn ok(&self, msg: impl AsRef<str>) {
        println!("[OK] {}", msg.as_ref());
    }

    fn fixed(&mut self, msg: impl AsRef<str>) {
        // A fix resolves a previously-counted Blocking; decrement so the
        // strict-mode tally reflects what's actually still broken.
        self.blocking = self.blocking.saturating_sub(1);
        self.fixed += 1;
        println!("[FIXED] {}", msg.as_ref());
    }
}

pub(crate) async fn cmd_doctor(
    config_path: &Option<PathBuf>,
    fix: bool,
    strict: bool,
) -> Result<()> {
    println!(
        "AEQI Doctor{}\n============\n",
        match (fix, strict) {
            (true, true) => " (--fix --strict)",
            (true, false) => " (--fix)",
            (false, true) => " (--strict)",
            (false, false) => "",
        }
    );

    let mut t = Tally::default();

    match load_config_with_agents(config_path) {
        Ok((config, path)) => {
            t.ok(format!("Config: {}", path.display()));
            for issue in config.validate() {
                t.report(Severity::Blocking, format!("Config validation: {issue}"));
            }
            if let Some(ref runtime) = config.aeqi.default_runtime {
                t.ok(format!("Default runtime: {runtime}"));
            }

            let store_path = provider_secret_store_path(&config);
            let secret_store = SecretStore::open(&store_path).ok();

            if let Some(ref or) = config.providers.openrouter {
                let api_key = if !or.api_key.is_empty() {
                    Some(or.api_key.clone())
                } else {
                    secret_store
                        .as_ref()
                        .and_then(|s| s.get("OPENROUTER_API_KEY").ok())
                };

                match api_key {
                    Some(_) => {
                        let provider = build_provider_for_runtime(
                            &config,
                            aeqi_core::ProviderKind::OpenRouter,
                            Some(&or.default_model),
                        )?;
                        match provider.health_check().await {
                            Ok(()) => t.ok("OpenRouter API key valid"),
                            Err(e) => t.report(
                                Severity::Blocking,
                                format!(
                                    "OpenRouter: {e} (key is set but the provider rejected it)"
                                ),
                            ),
                        }
                    }
                    None => t.report(
                        Severity::NeedsAction,
                        "OpenRouter API key not set — run \
                         `aeqi secrets set OPENROUTER_API_KEY <key>`",
                    ),
                }
            }
            if let Some(ref anthropic) = config.providers.anthropic {
                let api_key = if !anthropic.api_key.is_empty() {
                    Some(anthropic.api_key.clone())
                } else {
                    secret_store
                        .as_ref()
                        .and_then(|s| s.get("ANTHROPIC_API_KEY").ok())
                };

                match api_key {
                    Some(_) => {
                        let provider = build_provider_for_runtime(
                            &config,
                            aeqi_core::ProviderKind::Anthropic,
                            Some(&anthropic.default_model),
                        )?;
                        match provider.health_check().await {
                            Ok(()) => t.ok("Anthropic API key valid"),
                            Err(e) => t.report(
                                Severity::Blocking,
                                format!("Anthropic: {e} (key is set but the provider rejected it)"),
                            ),
                        }
                    }
                    None => t.report(
                        Severity::NeedsAction,
                        "Anthropic API key not set — run \
                         `aeqi secrets set ANTHROPIC_API_KEY <key>`",
                    ),
                }
            }
            if let Some(ref ollama) = config.providers.ollama {
                let provider = build_provider_for_runtime(
                    &config,
                    aeqi_core::ProviderKind::Ollama,
                    Some(&ollama.default_model),
                )?;
                match provider.health_check().await {
                    Ok(()) => t.ok(format!("Ollama reachable at {}", ollama.url)),
                    Err(e) => t.report(
                        Severity::Optional,
                        format!(
                            "Ollama: {e} (start ollama and pull the configured model \
                             before running quests)"
                        ),
                    ),
                }
            }
            if config.providers.openrouter.is_none()
                && config.providers.anthropic.is_none()
                && config.providers.ollama.is_none()
            {
                t.report(
                    Severity::Blocking,
                    "No providers configured — agents cannot reason without one. \
                     Add [providers.openrouter] / [providers.anthropic] / \
                     [providers.ollama] to aeqi.toml.",
                );
            }

            for pcfg in &config.agent_spawns {
                let runtime = config.runtime_for_project(&pcfg.name);
                let mode = config.execution_mode_for_project(&pcfg.name);
                let repo_ok = PathBuf::from(&pcfg.repo).exists();
                let line = format!(
                    "Project '{}' repo: {} | runtime={} | mode={:?} | model={}",
                    pcfg.name,
                    pcfg.repo,
                    runtime.provider,
                    mode,
                    config.model_for_project(&pcfg.name),
                );
                if repo_ok {
                    t.ok(&line);
                } else {
                    // A configured project pointing at a path that doesn't
                    // exist on this machine is most often a fresh-clone
                    // situation, not a corrupt install — surface it but
                    // don't gate strict mode.
                    t.report(Severity::Optional, &line);
                }

                match find_project_dir_for_config(&pcfg.name, &path, &config.data_dir()) {
                    Ok(d) => {
                        let agents_md = d.join("AGENTS.md").exists();
                        let knowledge_md = d.join("KNOWLEDGE.md").exists();
                        let tasks_dir = d.join(".tasks");
                        let has_tasks = tasks_dir.exists();
                        if !agents_md {
                            t.report(
                                Severity::NeedsAction,
                                format!("    Project '{}' has no AGENTS.md", pcfg.name),
                            );
                        }
                        println!(
                            "    Project files: AGENTS.md={agents_md} KNOWLEDGE.md={knowledge_md} | Tasks: {has_tasks}"
                        );

                        if fix && !has_tasks {
                            std::fs::create_dir_all(&tasks_dir)?;
                            t.fixed(format!(
                                "Created .tasks directory under project '{}'",
                                pcfg.name
                            ));
                        }

                        let skills_dir = d.join("skills");
                        let skill_count = if skills_dir.exists() {
                            Prompt::discover(&skills_dir).map(|s| s.len()).unwrap_or(0)
                        } else {
                            0
                        };
                        let pipelines_dir = if d.join("pipelines").exists() {
                            d.join("pipelines")
                        } else {
                            d.join("rituals")
                        };
                        let pipeline_count = if pipelines_dir.exists() {
                            std::fs::read_dir(&pipelines_dir)
                                .map(|e| {
                                    e.filter(|e| {
                                        e.as_ref()
                                            .ok()
                                            .map(|e| {
                                                e.path().extension().is_some_and(|x| x == "toml")
                                            })
                                            .unwrap_or(false)
                                    })
                                    .count()
                                })
                                .unwrap_or(0)
                        } else {
                            0
                        };
                        println!("    Skills: {skill_count} | Pipelines: {pipeline_count}");

                        let mem_db = d.join(".aeqi").join("memory.db");
                        if mem_db.exists() {
                            println!("    Memory (legacy): {}", mem_db.display());
                        }
                    }
                    Err(_) => t.report(
                        Severity::Optional,
                        format!(
                            "    Project dir for '{}' not found on disk \
                             (fine if you haven't cloned it yet)",
                            pcfg.name
                        ),
                    ),
                }
            }

            // Agent seed files — `aeqi setup` writes
            // `agents/<name>/agent.md`; legacy split (PERSONA.md +
            // IDENTITY.md) still recognised. A configured agent with
            // neither layout is a Blocking issue: the registry can't
            // load it.
            for agent_cfg in &config.agents {
                let runtime = config.runtime_for_agent(&agent_cfg.name);
                let mode = config.execution_mode_for_agent(&agent_cfg.name);
                match find_agent_dir_for_config(&agent_cfg.name, &path, &config.data_dir()) {
                    Ok(d) => {
                        let has_agent_md = d.join("agent.md").exists();
                        let has_persona = d.join("PERSONA.md").exists();
                        let has_identity = d.join("IDENTITY.md").exists();
                        let ok = has_agent_md || (has_persona && has_identity);
                        let layout = if has_agent_md {
                            "agent.md"
                        } else if has_persona && has_identity {
                            "PERSONA.md+IDENTITY.md (legacy)"
                        } else {
                            "missing"
                        };
                        let line = format!(
                            "Agent '{}': {layout} | runtime={} | mode={:?} | model={}",
                            agent_cfg.name,
                            runtime.provider,
                            mode,
                            config.model_for_agent(&agent_cfg.name),
                        );
                        if ok {
                            t.ok(&line);
                        } else {
                            t.report(Severity::Blocking, &line);
                        }
                    }
                    Err(_) => t.report(
                        Severity::Blocking,
                        format!(
                            "Agent dir not found for '{}' — run `aeqi setup --force` \
                             to recreate the seed files",
                            agent_cfg.name
                        ),
                    ),
                }
            }

            if store_path.exists() {
                t.ok(format!("Secret store: {}", store_path.display()));
            } else if fix {
                std::fs::create_dir_all(&store_path)?;
                t.fixed(format!("Created secret store: {}", store_path.display()));
            } else {
                t.report(
                    Severity::Blocking,
                    format!(
                        "Secret store missing: {} — run `aeqi doctor --fix` or \
                         `aeqi setup` to recreate",
                        store_path.display()
                    ),
                );
            }

            let mem_path = config.data_dir().join("aeqi.db");
            let label = "Ideas DB (aeqi.db)";
            if mem_path.exists() {
                t.ok(format!("{label}: {}", mem_path.display()));
            } else {
                println!(
                    "[INFO] {label}: {} (will be created on first daemon boot)",
                    mem_path.display()
                );
            }

            if mem_path.exists() {
                match audit_credentials(&mem_path, &store_path).await {
                    Ok(report) => {
                        t.ok(format!("Credentials: {} row(s)", report.total));
                        for entry in &report.entries {
                            if entry.code == CredentialReasonCode::Ok {
                                println!(
                                    "    [OK] {}/{}#{} ({}): {}",
                                    entry.scope,
                                    entry.provider,
                                    entry.name,
                                    entry.lifecycle,
                                    entry.code,
                                );
                            } else {
                                t.report(
                                    Severity::Blocking,
                                    format!(
                                        "    {}/{}#{} ({}): {}",
                                        entry.scope,
                                        entry.provider,
                                        entry.name,
                                        entry.lifecycle,
                                        entry.code,
                                    ),
                                );
                            }
                        }
                    }
                    Err(e) => t.report(Severity::Blocking, format!("Credentials audit: {e}")),
                }
            }

            match aeqi_orchestrator::agent_registry::AgentRegistry::open(&config.data_dir()) {
                Ok(reg) => {
                    let ehs = aeqi_orchestrator::EventHandlerStore::new(reg.db());
                    let count = ehs.count_enabled().await.unwrap_or(0);
                    t.ok(format!("Event handlers: {count} enabled"));

                    let channel_store = aeqi_orchestrator::ChannelStore::new(reg.db());
                    match channel_store.list_enabled().await {
                        Ok(channels) => {
                            t.ok(format!("Runtime channels: {} enabled", channels.len()));
                            for ch in channels {
                                let agent_label = reg
                                    .get(&ch.agent_id)
                                    .await
                                    .ok()
                                    .flatten()
                                    .map(|a| a.name)
                                    .unwrap_or_else(|| ch.agent_id.clone());
                                let bound_sessions = reg
                                    .list_channel_session_records(&ch.agent_id)
                                    .await?
                                    .into_iter()
                                    .filter(|record| {
                                        record.key.transport == ch.kind.as_str()
                                            && record.key.agent_id == ch.agent_id
                                    })
                                    .count();
                                println!(
                                    "    Channel {} kind={} agent={} allowed_chats={} channel_sessions={}",
                                    ch.id,
                                    ch.kind.as_str(),
                                    agent_label,
                                    ch.allowed_chats.len(),
                                    bound_sessions,
                                );
                                if ch.allowed_chats.is_empty() {
                                    t.report(
                                        Severity::Optional,
                                        format!(
                                            "    Channel {} ({}) has no allowed chat/contact rows; \
                                             set an explicit whitelist for production transports.",
                                            ch.id,
                                            ch.kind.as_str(),
                                        ),
                                    );
                                }
                            }
                        }
                        Err(e) => t.report(
                            Severity::Blocking,
                            format!("Runtime channels audit failed: {e}"),
                        ),
                    }
                }
                Err(_) => println!("[INFO] Event handlers: no agent registry"),
            }

            let data_dir = config.data_dir();
            if data_dir.exists() {
                t.ok(format!("Data dir: {}", data_dir.display()));
            } else if fix {
                std::fs::create_dir_all(&data_dir)?;
                t.fixed(format!("Created data dir: {}", data_dir.display()));
            } else {
                t.report(
                    Severity::Blocking,
                    format!("Data dir missing: {}", data_dir.display()),
                );
            }
        }
        Err(e) => {
            t.report(
                Severity::Blocking,
                format!("Config: {e} — run `aeqi setup` to create one"),
            );
        }
    }

    println!();
    let total = t.blocking + t.needs_action + t.optional;
    if total == 0 && t.fixed == 0 {
        println!("All checks passed.");
    } else {
        println!(
            "Summary: {} blocking, {} needs-action, {} optional, {} fixed.",
            t.blocking, t.needs_action, t.optional, t.fixed
        );
        if !fix && t.blocking > 0 {
            println!("Run `aeqi doctor --fix` to auto-repair structural issues.");
        }
    }

    if strict && t.blocking > 0 {
        bail!(
            "doctor found {} blocking issue(s) (--strict). NEEDS / OPT items \
             do not gate strict mode — use them as a setup checklist.",
            t.blocking
        );
    }

    Ok(())
}

struct CredentialEntry {
    scope: String,
    provider: String,
    name: String,
    lifecycle: String,
    code: CredentialReasonCode,
}

struct CredentialReport {
    total: usize,
    entries: Vec<CredentialEntry>,
}

/// Walk every credential row, return per-row reason codes.
///
/// The check is offline: we open the row, decode the blob, and consult the
/// matching lifecycle handler's static schema. We do NOT call refresh
/// endpoints from `aeqi doctor` (avoids consuming a refresh_token on every
/// `--strict` invocation; leave actual refresh to the runtime path).
async fn audit_credentials(aeqi_db: &Path, secrets_dir: &Path) -> Result<CredentialReport> {
    let conn = Connection::open(aeqi_db)?;
    let cipher = CredentialCipher::open(secrets_dir)?;
    let store = CredentialStore::new(Arc::new(Mutex::new(conn)), cipher);
    let lifecycles: Vec<Arc<dyn aeqi_core::credentials::CredentialLifecycle>> = vec![
        Arc::new(StaticSecretLifecycle),
        Arc::new(OAuth2Lifecycle),
        Arc::new(DeviceSessionLifecycle),
        Arc::new(GithubAppLifecycle),
        Arc::new(ServiceAccountLifecycle),
    ];
    let resolver = CredentialResolver::new(store.clone(), lifecycles);
    let rows = store.list_all().await?;
    let total = rows.len();
    let mut entries = Vec::with_capacity(total);
    for row in rows {
        let code = classify_row(&row, &resolver, &store);
        entries.push(CredentialEntry {
            scope: format!("{}:{}", row.scope_kind.as_str(), row.scope_id),
            provider: row.provider,
            name: row.name,
            lifecycle: row.lifecycle_kind,
            code,
        });
    }
    Ok(CredentialReport { total, entries })
}

fn classify_row(
    row: &CredentialRow,
    resolver: &CredentialResolver,
    store: &CredentialStore,
) -> CredentialReasonCode {
    let lifecycle = match resolver.lifecycle_for(row.lifecycle_kind.as_str()) {
        Some(l) => l,
        None => return CredentialReasonCode::UnsupportedLifecycle,
    };
    let plaintext = match store.decrypt(row) {
        Ok(p) => p,
        Err(_) => return CredentialReasonCode::RefreshFailed,
    };
    if let Err(_e) = lifecycle.validate(&plaintext, &row.metadata) {
        return CredentialReasonCode::RefreshFailed;
    }
    if let Some(exp) = row.expires_at
        && exp <= Utc::now()
    {
        return CredentialReasonCode::Expired;
    }
    CredentialReasonCode::Ok
}
