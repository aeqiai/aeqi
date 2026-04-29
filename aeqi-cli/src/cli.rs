use clap::Subcommand;

#[derive(Subcommand)]
pub enum Commands {
    /// Run a one-shot agent with a prompt.
    Run {
        prompt: String,
        #[arg(short = 'r', long = "root")]
        root: Option<String>,
        #[arg(short, long)]
        model: Option<String>,
        #[arg(long, default_value = "20")]
        max_iterations: u32,
    },
    /// Start daemon + web server in a single process.
    Start {
        /// Override web server bind address (default: from config or 0.0.0.0:8400).
        #[arg(long)]
        bind: Option<String>,
    },
    /// Initialize AEQI in the current directory.
    Init,
    /// Bootstrap a ready-to-run AEQI workspace.
    Setup {
        /// Default runtime preset (for example: openrouter_agent, anthropic_agent, ollama_agent).
        #[arg(long, default_value = "openrouter_agent")]
        runtime: String,
        /// Install a per-user daemon service after bootstrapping.
        #[arg(long)]
        service: bool,
        /// Overwrite starter files that already exist.
        #[arg(long)]
        force: bool,
    },
    /// Manage encrypted secrets.
    Secrets {
        #[command(subcommand)]
        action: SecretsAction,
    },
    /// Run diagnostics.
    Doctor {
        /// Auto-fix detected issues.
        #[arg(long)]
        fix: bool,
        /// Exit with a non-zero status if any issues remain.
        #[arg(long)]
        strict: bool,
    },
    /// Show system status.
    Status,
    /// Show a consolidated operator monitor view.
    Monitor {
        /// Focus on a single root agent.
        #[arg(short = 'r', long = "root")]
        root: Option<String>,
        /// Refresh the monitor continuously.
        #[arg(long)]
        watch: bool,
        /// Refresh interval in seconds when --watch is enabled.
        #[arg(long, default_value = "5")]
        interval_secs: u64,
        /// Emit the monitor report as JSON.
        #[arg(long)]
        json: bool,
    },

    // --- Phase 2: Quests ---
    /// Assign a quest to a root agent.
    Assign {
        subject: String,
        #[arg(short = 'r', long = "root")]
        root: String,
        #[arg(short, long, default_value = "")]
        description: String,
        #[arg(short, long)]
        priority: Option<String>,
    },
    /// Show unblocked (ready) work.
    Ready {
        #[arg(short = 'r', long = "root")]
        root: Option<String>,
    },
    /// Show all open quests.
    Quests {
        #[arg(short = 'r', long = "root")]
        root: Option<String>,
        #[arg(long)]
        all: bool,
    },
    /// Close a quest.
    Close {
        id: String,
        #[arg(short, long, default_value = "completed")]
        reason: String,
    },

    // --- Phase 3: Orchestrator ---
    /// Manage the daemon.
    Daemon {
        #[command(subcommand)]
        action: DaemonAction,
    },

    // --- Ideas ---
    /// Search, store, and manage ideas.
    Ideas {
        #[command(subcommand)]
        action: IdeasAction,
    },

    // --- Events ---
    /// Manage event handlers (schedule, install defaults, etc.).
    Events {
        #[command(subcommand)]
        action: EventsAction,
    },

    // --- Phase 5: Pipelines ---
    /// Pipeline workflow commands.
    Pipeline {
        #[command(subcommand)]
        action: PipelineAction,
    },

    // --- Phase 7: Prompts ---
    /// List or run prompts.
    Prompt {
        #[command(subcommand)]
        action: PromptAction,
    },

    // --- Missions ---
    // --- Cross-root ---
    /// Track work across root agents.
    Operation {
        #[command(subcommand)]
        action: OperationAction,
    },

    // --- Worker management ---
    /// Development tools for Claude Code hook scripts.
    Hooks {
        #[command(subcommand)]
        action: HooksAction,
    },
    /// Pin work to a worker.
    Hook { worker: String, quest_id: String },
    /// Mark quest as done, trigger cleanup.
    Done {
        quest_id: String,
        #[arg(short, long, default_value = "completed")]
        reason: String,
    },

    /// Show system team and per-root teams.
    Team {
        /// Show team for a specific root agent.
        #[arg(short = 'r', long = "root")]
        root: Option<String>,
    },

    // --- Config ---
    /// Reload configuration.
    Config {
        #[command(subcommand)]
        action: ConfigAction,
    },

    /// Manage agent discovery and configuration.
    Agent {
        #[command(subcommand)]
        action: AgentAction,
    },

    /// Query the decision audit trail.
    Audit {
        /// Filter by root agent name.
        #[arg(short = 'r', long = "root")]
        root: Option<String>,
        /// Filter by quest ID.
        #[arg(short, long)]
        quest: Option<String>,
        /// Show last N events.
        #[arg(short, long, default_value = "20")]
        last: u32,
    },

    /// Suggest or apply inferred quest dependencies.
    Deps {
        #[arg(short = 'r', long = "root")]
        root: String,
        /// Auto-apply dependencies above this confidence threshold.
        #[arg(long)]
        apply: Option<f64>,
    },

    /// Start the web API server.
    Web {
        #[command(subcommand)]
        action: WebAction,
    },

    /// Code intelligence graph — index, query, and analyze code structure.
    Graph {
        #[command(subcommand)]
        action: GraphAction,
    },

    /// Interactive streaming chat with a AEQI agent (TUI).
    Chat {
        /// Persistent agent to chat with (default: auto-select based on root).
        #[arg(short, long)]
        agent: Option<String>,
        /// Root agent scope for agent selection and memory.
        #[arg(short = 'r', long = "root")]
        root: Option<String>,
    },

    /// Emit session primer context from the daemon (replaces session-primer.sh).
    Primer,

    /// Run as an MCP (Model Context Protocol) server.
    Mcp,

    /// Seed preset ideas (skills + vanilla identity) into the idea store.
    Seed,
}

#[derive(Subcommand)]
pub enum GraphAction {
    /// Index (or re-index) the code graph for a root agent.
    Index {
        #[arg(short = 'r', long = "root")]
        root: String,
        /// Full re-index instead of incremental (git-diff based).
        #[arg(long)]
        full: bool,
    },
    /// Show graph statistics for a root agent.
    Stats {
        #[arg(short = 'r', long = "root")]
        root: String,
    },
}

#[derive(Subcommand)]
pub enum AgentAction {
    /// List all discovered agents (from disk + TOML).
    List,
    /// Spawn a new persistent agent. For pre-threaded companies (root +
    /// seed agents/events/ideas/quests), use `aeqi template spawn <slug>`.
    Spawn {
        /// Name of the new agent.
        name: String,
        /// Parent agent id — attach the new agent under an existing one.
        #[arg(short = 'p', long = "parent")]
        parent: Option<String>,
        /// Optional model override (e.g. `anthropic/claude-sonnet-4.6`).
        #[arg(short = 'm', long = "model")]
        model: Option<String>,
    },
    /// Show details of a persistent agent.
    Show {
        /// Agent name.
        name: String,
    },
    /// Retire a persistent agent (preserves memory).
    Retire {
        /// Agent name.
        name: String,
    },
    /// Reactivate a paused or retired agent.
    Activate {
        /// Agent name.
        name: String,
    },
    /// List all persistent agents from the registry.
    Registry {
        /// Filter by owning entity (id or slug).
        #[arg(short = 'e', long = "entity")]
        entity: Option<String>,
    },
}

#[derive(Subcommand)]
pub enum SecretsAction {
    Set { name: String, value: String },
    Get { name: String },
    List,
    Delete { name: String },
}

#[derive(Subcommand)]
pub enum DaemonAction {
    /// Start the daemon (runs in foreground).
    Start,
    /// Install a per-user daemon service.
    Install {
        /// Start the service immediately after installing it.
        #[arg(long)]
        start: bool,
        /// Overwrite an existing service definition.
        #[arg(long)]
        force: bool,
    },
    /// Print the generated service definition.
    PrintService,
    /// Stop a running daemon.
    Stop,
    /// Uninstall the per-user daemon service.
    Uninstall {
        /// Stop the service before removing it.
        #[arg(long)]
        stop: bool,
    },
    /// Show daemon status.
    Status,
    /// Query the running daemon via IPC socket.
    Query {
        /// Command to send (ping, status, readiness, roots, dispatches, cost, metrics, audit, expertise).
        cmd: String,
    },
}

#[derive(Subcommand)]
pub enum ConfigAction {
    /// Reload configuration (send SIGHUP to daemon).
    Reload,
    /// Show current config.
    Show,
}

#[derive(Subcommand)]
pub enum PromptAction {
    /// List available prompts for a root agent.
    List {
        #[arg(short = 'r', long = "root")]
        root: Option<String>,
    },
    /// Run a prompt by name.
    Run {
        name: String,
        #[arg(short = 'r', long = "root")]
        root: String,
        /// Additional user prompt appended after the prompt's user_prefix.
        prompt: Option<String>,
    },
}

#[derive(Subcommand)]
pub enum OperationAction {
    /// Create an operation tracking quests across root agents.
    Create {
        name: String,
        /// Quest IDs to track (e.g. as-001 rd-002).
        quest_ids: Vec<String>,
    },
    /// List active operations.
    List,
    /// Show operation status.
    Status { id: String },
}

#[derive(Subcommand)]
pub enum PipelineAction {
    /// Pour (instantiate) a pipeline workflow.
    Pour {
        template: String,
        #[arg(short = 'r', long = "root")]
        root: String,
        /// Variables as key=value pairs.
        #[arg(long = "var")]
        vars: Vec<String>,
    },
    /// List available pipeline templates.
    List {
        #[arg(short = 'r', long = "root")]
        root: Option<String>,
    },
    /// Show status of a pipeline (parent quest and its children).
    Status { id: String },
}

#[derive(Subcommand)]
pub enum HooksAction {
    /// Test a hook script with simulated input.
    Test {
        /// Script name (e.g., "check-recall") or full path.
        script: String,
        /// Tool input JSON.
        #[arg(long)]
        input: Option<String>,
        /// Tool name context.
        #[arg(long, default_value = "Edit")]
        tool: String,
    },
    /// Validate all hook scripts from Claude Code settings.
    Validate,
    /// List active hooks from Claude Code settings.
    List,
    /// Benchmark hook execution times.
    Bench {
        /// Script name to benchmark (benchmarks all hot-path hooks if omitted).
        script: Option<String>,
        /// Number of iterations.
        #[arg(long, default_value = "20")]
        iterations: u32,
    },
    /// Install git hook shims into .githooks/ that delegate to `aeqi hooks run`.
    Install,
    /// Run a git hook by name (called by the installed shims).
    Run {
        /// Hook name (e.g. post-commit, post-merge, post-checkout).
        hook: String,
        /// Extra arguments passed by git.
        #[arg(trailing_var_arg = true)]
        args: Vec<String>,
    },
}

#[derive(Subcommand)]
pub enum WebAction {
    /// Start the web API server.
    Start {
        /// Override bind address (default: from config or 0.0.0.0:8400).
        #[arg(long)]
        bind: Option<String>,
    },
}

#[derive(Subcommand)]
pub enum IdeasAction {
    /// Search ideas via full-text + vector ranking.
    Search {
        query: String,
        #[arg(short = 'r', long = "root")]
        root: Option<String>,
        #[arg(short, long, default_value = "5")]
        top_k: usize,
    },
    /// Store an idea.
    Store {
        name: String,
        content: String,
        #[arg(short = 'r', long = "root")]
        root: Option<String>,
    },
    /// Export all ideas to an Obsidian vault.
    Export {
        /// Path to the Obsidian vault directory.
        #[arg(long)]
        vault: std::path::PathBuf,
    },
    /// Import ideas from an Obsidian vault.
    ///
    /// Import normally routes through the daemon IPC so every idea goes
    /// through the full write pipeline (dedup, async embedding, tag
    /// policy, inline-link edge reconciliation, consolidation checks).
    /// Pass `--no-daemon` to force the direct SQLite path when the
    /// daemon isn't running or for offline migrations.
    Import {
        /// Path to the Obsidian vault directory.
        #[arg(long)]
        vault: std::path::PathBuf,
        /// Bypass the daemon and write directly to SQLite. Skips dedup,
        /// embedding, tag policy, and edge reconciliation.
        #[arg(long = "no-daemon")]
        no_daemon: bool,
    },
    /// Merge tags from a snapshot DB into the live ideas store.
    ///
    /// Use this to restore tag data wiped by a past migration — opens the
    /// snapshot read-only, looks up each idea in the live DB (by name or
    /// id), and `INSERT OR IGNORE`s missing `idea_tags` rows. Never
    /// creates new ideas, never overwrites existing tags.
    RecoverTags {
        /// Snapshot DB path to read tags from.
        #[arg(long)]
        from: std::path::PathBuf,
        /// How to match ideas between snapshot and live: `name` (default) or `id`.
        #[arg(long, default_value = "name")]
        r#match: String,
        /// Preview changes without writing.
        #[arg(long)]
        dry_run: bool,
        /// Skip the confirmation prompt.
        #[arg(long)]
        yes: bool,
    },
}

#[derive(Subcommand)]
pub enum EventsAction {
    /// Install the two standard schedule events (`daily-digest`,
    /// `weekly-consolidate`) on every existing agent. Idempotent — rows
    /// already present are skipped via the unique index.
    InstallDefaults {
        /// Restrict the install to named agents. Pass `--agent NAME` per
        /// target; omit to target every agent in the registry.
        #[arg(long = "agent")]
        agents: Vec<String>,
        /// Preview which agents would gain which events without writing.
        #[arg(long)]
        dry_run: bool,
    },
}
