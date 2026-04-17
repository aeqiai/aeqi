use aeqi_core::traits::Idea;
use chrono::{DateTime, TimeZone, Utc};

/// Build an [`Idea`] for tests.
///
/// Defaults:
/// - `id` — `"idea-test"`
/// - `name` — `"idea"`
/// - `content` — `""`
/// - `created_at` — fixed epoch moment (`2025-01-01T00:00:00Z`) for deterministic output
/// - all optional fields — `None` / empty
///
/// ```
/// use aeqi_test_support::IdeaBuilder;
///
/// let idea = IdeaBuilder::new()
///     .id("i-1")
///     .name("channel:telegram")
///     .agent("alice")
///     .build();
/// assert_eq!(idea.name, "channel:telegram");
/// ```
pub struct IdeaBuilder {
    id: String,
    name: String,
    content: String,
    tags: Vec<String>,
    agent_id: Option<String>,
    created_at: DateTime<Utc>,
    session_id: Option<String>,
    score: f64,
    injection_mode: Option<String>,
    inheritance: String,
    tool_allow: Vec<String>,
    tool_deny: Vec<String>,
}

impl Default for IdeaBuilder {
    fn default() -> Self {
        Self {
            id: "idea-test".into(),
            name: "idea".into(),
            content: String::new(),
            tags: Vec::new(),
            agent_id: None,
            // Fixed timestamp → reproducible serde snapshots in tests.
            created_at: Utc.with_ymd_and_hms(2025, 1, 1, 0, 0, 0).unwrap(),
            session_id: None,
            score: 1.0,
            injection_mode: None,
            inheritance: "self".into(),
            tool_allow: Vec::new(),
            tool_deny: Vec::new(),
        }
    }
}

impl IdeaBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn id(mut self, id: impl Into<String>) -> Self {
        self.id = id.into();
        self
    }

    pub fn name(mut self, name: impl Into<String>) -> Self {
        self.name = name.into();
        self
    }

    pub fn content(mut self, content: impl Into<String>) -> Self {
        self.content = content.into();
        self
    }

    pub fn tags<I, S>(mut self, tags: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.tags = tags.into_iter().map(Into::into).collect();
        self
    }

    pub fn agent(mut self, agent_id: impl Into<String>) -> Self {
        self.agent_id = Some(agent_id.into());
        self
    }

    pub fn session(mut self, session_id: impl Into<String>) -> Self {
        self.session_id = Some(session_id.into());
        self
    }

    pub fn score(mut self, score: f64) -> Self {
        self.score = score;
        self
    }

    pub fn injection_mode(mut self, mode: impl Into<String>) -> Self {
        self.injection_mode = Some(mode.into());
        self
    }

    pub fn inheritance(mut self, inheritance: impl Into<String>) -> Self {
        self.inheritance = inheritance.into();
        self
    }

    pub fn created_at(mut self, at: DateTime<Utc>) -> Self {
        self.created_at = at;
        self
    }

    pub fn build(self) -> Idea {
        Idea {
            id: self.id,
            name: self.name,
            content: self.content,
            tags: self.tags,
            agent_id: self.agent_id,
            created_at: self.created_at,
            session_id: self.session_id,
            score: self.score,
            injection_mode: self.injection_mode,
            inheritance: self.inheritance,
            tool_allow: self.tool_allow,
            tool_deny: self.tool_deny,
        }
    }
}
