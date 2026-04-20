use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Virtual filesystem node types.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum VfsNodeType {
    Directory,
    File,
    Database,
}

/// Metadata for a VFS node.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VfsNode {
    pub name: String,
    pub path: String,
    pub node_type: VfsNodeType,
    pub size: Option<u64>,
    pub modified: Option<String>,
    pub mime: Option<String>,
    pub icon: Option<String>,
    pub badge: Option<String>,
}

/// Response for vfs_list.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VfsListResponse {
    pub path: String,
    pub nodes: Vec<VfsNode>,
}

/// Response for vfs_read.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VfsReadResponse {
    pub path: String,
    pub content: String,
    pub mime: String,
    pub editable: bool,
}

/// Search result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VfsSearchResult {
    pub path: String,
    pub name: String,
    pub snippet: Option<String>,
    pub node_type: VfsNodeType,
}

/// Response for vfs_search.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VfsSearchResponse {
    pub query: String,
    pub results: Vec<VfsSearchResult>,
}

/// The VFS tree builder. Maps virtual paths to real data sources.
pub struct VfsTree {
    agent_registry: Arc<crate::agent_registry::AgentRegistry>,
    session_store: Option<Arc<crate::session_store::SessionStore>>,
    skill_loader: Option<Arc<crate::skill_loader::SkillLoader>>,
}

impl VfsTree {
    pub fn new(agent_registry: Arc<crate::agent_registry::AgentRegistry>) -> Self {
        Self {
            agent_registry,
            session_store: None,
            skill_loader: None,
        }
    }

    /// Create a VfsTree with all direct dependencies.
    pub fn with_direct_deps(
        agent_registry: Arc<crate::agent_registry::AgentRegistry>,
        session_store: Option<Arc<crate::session_store::SessionStore>>,
        skill_loader: Option<Arc<crate::skill_loader::SkillLoader>>,
    ) -> Self {
        Self {
            agent_registry,
            session_store,
            skill_loader,
        }
    }

    /// Resolve session_store.
    fn resolve_session_store(&self) -> Option<&Arc<crate::session_store::SessionStore>> {
        self.session_store.as_ref()
    }

    /// List the contents of a virtual directory.
    pub async fn list(&self, path: &str) -> anyhow::Result<VfsListResponse> {
        let path = normalize_path(path);
        let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();

        let nodes = match segments.as_slice() {
            [] => self.list_root().await?,
            ["agents"] => self.list_agents().await?,
            ["agents", name] => self.list_agent_detail(name).await?,
            ["agents", name, "sessions"] => self.list_agent_sessions(name).await?,
            ["roots"] => self.list_root_agents_vfs().await?,
            ["roots", name] => self.list_root_agent_detail(name).await?,
            ["roots", name, "knowledge"] => self.list_root_agent_knowledge(name).await?,
            ["roots", name, "quests"] => self.list_root_agent_quests(name).await?,
            ["skills"] => self.list_skills().await?,
            ["sessions"] => self.list_sessions().await?,
            ["sessions", id] => self.list_session_detail(id).await?,
            ["config"] => self.list_config().await?,
            ["ideas"] => self.list_ideas().await?,
            ["finance"] => self.list_finance().await?,
            _ => vec![],
        };

        Ok(VfsListResponse { path, nodes })
    }

    /// Read the content of a virtual file.
    pub async fn read(&self, path: &str) -> anyhow::Result<VfsReadResponse> {
        let path = normalize_path(path);
        let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();

        match segments.as_slice() {
            ["agents", name, "identity.md"] => self.read_agent_identity(name).await,
            ["agents", name, "stats.json"] => self.read_agent_stats(name).await,
            ["roots", name, "info.json"] => self.read_root_agent_info(name).await,
            ["sessions", id, "transcript.json"] => self.read_session_transcript(id).await,
            ["sessions", id, "messages.json"] => self.read_session_messages(id).await,
            ["config", "aeqi.toml"] => self.read_config().await,
            _ => anyhow::bail!("not a readable file: {path}"),
        }
    }

    /// Search across all VFS nodes.
    pub async fn search(&self, query: &str) -> anyhow::Result<VfsSearchResponse> {
        let q = query.to_lowercase();
        let mut results = Vec::new();

        // Search agents
        if let Ok(agents) = self.agent_registry.list(None, None).await {
            for a in &agents {
                if a.name.to_lowercase().contains(&q) {
                    results.push(VfsSearchResult {
                        path: format!("/agents/{}", a.name),
                        name: a.name.clone(),
                        snippet: Some(a.status.to_string()),
                        node_type: VfsNodeType::Directory,
                    });
                }
            }
        }

        // Search root agents.
        if let Ok(agents) = self.agent_registry.list(None, None).await {
            for a in &agents {
                if a.parent_id.is_none() && a.name.to_lowercase().contains(&q) {
                    results.push(VfsSearchResult {
                        path: format!("/roots/{}", a.name),
                        name: a.name.clone(),
                        snippet: None,
                        node_type: VfsNodeType::Directory,
                    });
                }
            }
        }

        Ok(VfsSearchResponse {
            query: query.to_string(),
            results,
        })
    }

    // --- Root listing ---

    async fn list_root(&self) -> anyhow::Result<Vec<VfsNode>> {
        Ok(vec![
            dir_node("agents", "/agents", Some("🤖"), None),
            dir_node("roots", "/roots", Some("🏢"), None),
            dir_node("skills", "/skills", Some("⚡"), None),
            dir_node("sessions", "/sessions", Some("💬"), None),
            dir_node("ideas", "/ideas", Some("🧠"), None),
            dir_node("finance", "/finance", Some("💰"), None),
            dir_node("config", "/config", Some("⚙️"), None),
        ])
    }

    // --- Agents ---

    async fn list_agents(&self) -> anyhow::Result<Vec<VfsNode>> {
        let mut nodes = Vec::new();
        if let Ok(agents) = self.agent_registry.list(None, None).await {
            for a in &agents {
                let badge = match a.status {
                    crate::agent_registry::AgentStatus::Active => Some("active".to_string()),
                    crate::agent_registry::AgentStatus::Paused => Some("paused".to_string()),
                    crate::agent_registry::AgentStatus::Retired => Some("retired".to_string()),
                };
                nodes.push(dir_node(
                    &a.name,
                    &format!("/agents/{}", a.name),
                    Some("🤖"),
                    badge,
                ));
            }
        }
        Ok(nodes)
    }

    async fn list_agent_detail(&self, name: &str) -> anyhow::Result<Vec<VfsNode>> {
        let mut nodes = vec![
            file_node(
                "identity.md",
                &format!("/agents/{name}/identity.md"),
                "text/markdown",
                Some("📋"),
            ),
            file_node(
                "stats.json",
                &format!("/agents/{name}/stats.json"),
                "application/json",
                Some("📊"),
            ),
            dir_node(
                "sessions",
                &format!("/agents/{name}/sessions"),
                Some("💬"),
                None,
            ),
        ];

        // Check for identity files on disk
        let cwd = std::env::current_dir().unwrap_or_default();
        let agent_dir = cwd.join("agents").join(name);
        if let Ok(mut entries) = tokio::fs::read_dir(&agent_dir).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let fname = entry.file_name().to_string_lossy().to_string();
                if fname != "identity.md" && fname != "stats.json" {
                    let mime = if fname.ends_with(".md") {
                        "text/markdown"
                    } else if fname.ends_with(".toml") {
                        "text/toml"
                    } else {
                        "text/plain"
                    };
                    nodes.push(file_node(
                        &fname,
                        &format!("/agents/{name}/{fname}"),
                        mime,
                        Some("📄"),
                    ));
                }
            }
        }

        Ok(nodes)
    }

    async fn list_agent_sessions(&self, name: &str) -> anyhow::Result<Vec<VfsNode>> {
        let mut nodes = Vec::new();
        if let Some(sm) = self.resolve_session_store()
            && let Ok(sessions) = sm.list_sessions(Some(name), 50).await
        {
            for s in &sessions {
                let badge = if s.status == "active" {
                    Some("active".to_string())
                } else {
                    Some("closed".to_string())
                };
                nodes.push(dir_node(
                    &s.id,
                    &format!("/sessions/{}", s.id),
                    Some("💬"),
                    badge,
                ));
            }
        }
        Ok(nodes)
    }

    // --- Root agents (exposed under /roots in the VFS) ---

    async fn list_root_agents_vfs(&self) -> anyhow::Result<Vec<VfsNode>> {
        let mut nodes = Vec::new();
        if let Ok(agents) = self.agent_registry.list(None, None).await {
            for a in &agents {
                if a.parent_id.is_none() {
                    nodes.push(dir_node(
                        &a.name,
                        &format!("/roots/{}", a.name),
                        Some("🏢"),
                        None,
                    ));
                }
            }
        }
        Ok(nodes)
    }

    async fn list_root_agent_detail(&self, name: &str) -> anyhow::Result<Vec<VfsNode>> {
        Ok(vec![
            file_node(
                "info.json",
                &format!("/roots/{name}/info.json"),
                "application/json",
                Some("ℹ️"),
            ),
            dir_node(
                "knowledge",
                &format!("/roots/{name}/knowledge"),
                Some("🧠"),
                None,
            ),
            dir_node("quests", &format!("/roots/{name}/quests"), Some("📋"), None),
        ])
    }

    async fn list_root_agent_knowledge(&self, _name: &str) -> anyhow::Result<Vec<VfsNode>> {
        // Knowledge now lives in the idea store, not notes.
        Ok(vec![])
    }

    async fn list_root_agent_quests(&self, _name: &str) -> anyhow::Result<Vec<VfsNode>> {
        // Quests are agent-scoped; stub for VFS compatibility.
        Ok(vec![])
    }

    // --- Skills ---

    async fn list_skills(&self) -> anyhow::Result<Vec<VfsNode>> {
        if let Some(ref loader) = self.skill_loader {
            let entries = loader.entries().await;
            let nodes = entries
                .iter()
                .map(|e| {
                    file_node(
                        &format!("{}.md", e.name),
                        &format!("/skills/{}.md", e.name),
                        "text/markdown",
                        Some("⚡"),
                    )
                })
                .collect();
            return Ok(nodes);
        }

        // No skill_loader configured — return empty.
        Ok(Vec::new())
    }

    // --- Sessions ---

    async fn list_sessions(&self) -> anyhow::Result<Vec<VfsNode>> {
        let mut nodes = Vec::new();
        if let Some(sm) = self.resolve_session_store()
            && let Ok(sessions) = sm.list_sessions(None, 100).await
        {
            for s in &sessions {
                let badge = if s.status == "active" {
                    Some("active".to_string())
                } else {
                    Some("closed".to_string())
                };
                nodes.push(dir_node(
                    &format!("{} ({})", s.id, s.agent_id.as_deref().unwrap_or("?")),
                    &format!("/sessions/{}", s.id),
                    Some("💬"),
                    badge,
                ));
            }
        }
        Ok(nodes)
    }

    async fn list_session_detail(&self, id: &str) -> anyhow::Result<Vec<VfsNode>> {
        Ok(vec![
            file_node(
                "transcript.json",
                &format!("/sessions/{id}/transcript.json"),
                "application/json",
                Some("📜"),
            ),
            file_node(
                "messages.json",
                &format!("/sessions/{id}/messages.json"),
                "application/json",
                Some("💬"),
            ),
        ])
    }

    // --- Ideas ---

    async fn list_ideas(&self) -> anyhow::Result<Vec<VfsNode>> {
        // Ideas are exposed via the idea store, not the VFS (yet).
        let nodes = Vec::new();
        Ok(nodes)
    }

    // --- Finance ---

    async fn list_finance(&self) -> anyhow::Result<Vec<VfsNode>> {
        Ok(vec![
            file_node(
                "budget.json",
                "/finance/budget.json",
                "application/json",
                Some("💰"),
            ),
            file_node(
                "spend.json",
                "/finance/spend.json",
                "application/json",
                Some("📊"),
            ),
        ])
    }

    // --- Config ---

    async fn list_config(&self) -> anyhow::Result<Vec<VfsNode>> {
        Ok(vec![file_node(
            "aeqi.toml",
            "/config/aeqi.toml",
            "text/toml",
            Some("⚙️"),
        )])
    }

    // --- File readers ---

    async fn read_agent_identity(&self, name: &str) -> anyhow::Result<VfsReadResponse> {
        let mut content = format!("# {name}\n\n");
        if let Ok(agents) = self.agent_registry.list(None, None).await
            && let Some(agent) = agents.iter().find(|a| a.name == *name)
        {
            content.push_str(&format!("**Status:** {}\n", agent.status));
            if let Some(ref model) = agent.model {
                content.push_str(&format!("**Model:** {model}\n"));
            }
        }

        // Also try reading identity.md from disk
        let cwd = std::env::current_dir().unwrap_or_default();
        let identity_path = cwd.join("agents").join(name).join("identity.md");
        if let Ok(disk_content) = tokio::fs::read_to_string(&identity_path).await {
            content.push_str("\n---\n\n");
            content.push_str(&disk_content);
        }

        Ok(VfsReadResponse {
            path: format!("/agents/{name}/identity.md"),
            content,
            mime: "text/markdown".to_string(),
            editable: true,
        })
    }

    async fn read_agent_stats(&self, name: &str) -> anyhow::Result<VfsReadResponse> {
        let mut stats = serde_json::json!({});
        if let Ok(agents) = self.agent_registry.list(None, None).await
            && let Some(agent) = agents.iter().find(|a| a.name == *name)
        {
            stats = serde_json::json!({
                "status": agent.status.to_string(),
                "model": agent.model,
                "created_at": agent.created_at,
            });
        }
        Ok(VfsReadResponse {
            path: format!("/agents/{name}/stats.json"),
            content: serde_json::to_string_pretty(&stats)?,
            mime: "application/json".to_string(),
            editable: false,
        })
    }

    async fn read_root_agent_info(&self, name: &str) -> anyhow::Result<VfsReadResponse> {
        // Look up the root agent matching this name.
        let info = if let Ok(agents) = self.agent_registry.list(None, None).await {
            agents
                .iter()
                .find(|a| a.name == *name && a.parent_id.is_none())
                .map(|a| {
                    serde_json::json!({
                        "name": a.name,
                        "status": a.status.to_string(),
                        "model": a.model,
                    })
                })
                .unwrap_or_else(|| serde_json::json!({"error": "root agent not found"}))
        } else {
            serde_json::json!({"error": "root agent not found"})
        };
        Ok(VfsReadResponse {
            path: format!("/roots/{name}/info.json"),
            content: serde_json::to_string_pretty(&info)?,
            mime: "application/json".to_string(),
            editable: false,
        })
    }

    async fn read_session_transcript(&self, id: &str) -> anyhow::Result<VfsReadResponse> {
        if let Some(sm) = self.resolve_session_store()
            && let Ok(Some(session)) = sm.get_session(id).await
        {
            let messages = sm.history_by_session(id, 200).await.unwrap_or_default();
            let data = serde_json::json!({
                "session": {
                    "id": session.id,
                    "agent_id": session.agent_id,
                    "status": session.status,
                    "created_at": session.created_at,
                },
                "messages": messages.iter().map(|m| serde_json::json!({
                    "role": m.role,
                    "content": m.content,
                    "timestamp": m.timestamp.to_rfc3339(),
                })).collect::<Vec<_>>(),
            });
            return Ok(VfsReadResponse {
                path: format!("/sessions/{id}/transcript.json"),
                content: serde_json::to_string_pretty(&data)?,
                mime: "application/json".to_string(),
                editable: false,
            });
        }
        Ok(VfsReadResponse {
            path: format!("/sessions/{id}/transcript.json"),
            content: "Session not found".to_string(),
            mime: "text/plain".to_string(),
            editable: false,
        })
    }

    async fn read_session_messages(&self, id: &str) -> anyhow::Result<VfsReadResponse> {
        if let Some(sm) = self.resolve_session_store()
            && let Ok(messages) = sm.history_by_session(id, 100).await
        {
            let mut content = String::new();
            for msg in &messages {
                content.push_str(&format!("[{}] {}\n\n", msg.role, msg.content));
            }
            if content.is_empty() {
                content = "No messages in this session.\n".to_string();
            }
            return Ok(VfsReadResponse {
                path: format!("/sessions/{id}/messages.json"),
                content,
                mime: "text/plain".to_string(),
                editable: false,
            });
        }
        Ok(VfsReadResponse {
            path: format!("/sessions/{id}/messages.json"),
            content: "Session not found".to_string(),
            mime: "text/plain".to_string(),
            editable: false,
        })
    }

    async fn read_config(&self) -> anyhow::Result<VfsReadResponse> {
        let config_path =
            std::env::var("AEQI_CONFIG_PATH").unwrap_or_else(|_| "config/aeqi.toml".to_string());
        let content = tokio::fs::read_to_string(&config_path)
            .await
            .unwrap_or_else(|_| "# Config file not found\n".to_string());
        Ok(VfsReadResponse {
            path: "/config/aeqi.toml".to_string(),
            content,
            mime: "text/toml".to_string(),
            editable: true,
        })
    }
}

// --- Public helpers ---

pub fn normalize_path(path: &str) -> String {
    let p = path.trim().trim_start_matches('/');
    let segments: Vec<&str> = p
        .split('/')
        .filter(|s| !s.is_empty() && *s != ".")
        .collect();
    let mut resolved: Vec<&str> = Vec::new();
    for seg in &segments {
        if *seg == ".." {
            resolved.pop();
        } else {
            resolved.push(seg);
        }
    }
    if resolved.is_empty() {
        String::new()
    } else {
        resolved.join("/")
    }
}

pub fn dir_node(name: &str, path: &str, icon: Option<&str>, badge: Option<String>) -> VfsNode {
    VfsNode {
        name: name.to_string(),
        path: path.to_string(),
        node_type: VfsNodeType::Directory,
        size: None,
        modified: None,
        mime: None,
        icon: icon.map(String::from),
        badge,
    }
}

pub fn file_node(name: &str, path: &str, mime: &str, icon: Option<&str>) -> VfsNode {
    VfsNode {
        name: name.to_string(),
        path: path.to_string(),
        node_type: VfsNodeType::File,
        size: None,
        modified: None,
        mime: Some(mime.to_string()),
        icon: icon.map(String::from),
        badge: None,
    }
}

pub fn file_node_with_badge(
    name: &str,
    path: &str,
    mime: &str,
    icon: Option<&str>,
    badge: Option<String>,
) -> VfsNode {
    VfsNode {
        name: name.to_string(),
        path: path.to_string(),
        node_type: VfsNodeType::File,
        size: None,
        modified: None,
        mime: Some(mime.to_string()),
        icon: icon.map(String::from),
        badge,
    }
}
