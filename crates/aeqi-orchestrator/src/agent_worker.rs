use aeqi_core::traits::{
    ChatRequest, Event, IdeaStore, LogObserver, LoopAction, Message, MessageContent, Observer,
    Provider, Role, Tool,
};
use aeqi_core::{Agent, AgentConfig, AssembledPrompt};
use aeqi_quests::{Quest, QuestOutcomeKind, QuestOutcomeRecord, QuestStatus};
use anyhow::Result;
use std::path::PathBuf;
use std::sync::Arc;
use tracing::{debug, info, warn};

use crate::activity::{Activity, ActivityStream};
use crate::activity_log::ActivityLog;
use crate::agent_registry::AgentRegistry;
use crate::checkpoint::AgentCheckpoint;
use crate::executor::QuestOutcome;
use crate::failure_analysis::{FailureAnalysis, FailureMode};
use crate::hook::Hook;
use crate::middleware::{MiddlewareAction, MiddlewareChain, Outcome, OutcomeStatus, WorkerContext};
use crate::runtime::{
    Artifact, ArtifactKind, RuntimeExecution, RuntimeOutcome, RuntimePhase, RuntimeSession,
};

/// Worker states.
#[derive(Debug, Clone, PartialEq)]
pub enum WorkerState {
    Idle,
    Hooked,
    Working,
    Done,
    Failed(String),
}

/// How a worker executes its assigned task.
pub enum WorkerExecution {
    /// Native AEQI agent loop.
    Agent {
        provider: Arc<dyn aeqi_core::traits::Provider>,
        tools: Vec<Arc<dyn Tool>>,
        model: String,
    },
    /// Delegate to Claude Code CLI.
    ClaudeCode { cwd: PathBuf, max_budget_usd: f64 },
}

/// An AgentWorker is an ephemeral task executor. Each worker runs as a tokio task
/// with its own identity, hook, and tool allowlist.
pub struct AgentWorker {
    /// Stable logical agent identity used for expertise, memory, and audit semantics.
    pub agent_name: String,
    /// Ephemeral worker-run identifier used for execution tracing.
    pub name: String,
    pub project_name: String,
    pub state: WorkerState,
    pub hook: Option<Hook>,
    pub execution: WorkerExecution,
    pub system_prompt: String,
    pub assembled_prompt: Option<AssembledPrompt>,
    pub activity_log: Arc<ActivityLog>,
    /// Snapshot of the assigned task, populated at assign() time.
    pub quest_snapshot: Option<aeqi_quests::Quest>,
    /// Called once at the end of execute() with the final status and optional outcome record.
    #[allow(clippy::type_complexity)]
    pub on_complete: Option<Box<dyn FnOnce(QuestStatus, Option<QuestOutcomeRecord>) + Send + Sync>>,
    pub idea_store: Option<Arc<dyn IdeaStore>>,
    pub reflect_provider: Option<Arc<dyn Provider>>,
    pub reflect_model: String,
    /// Project directory path for checkpoint storage.
    pub project_dir: Option<PathBuf>,
    /// Max task retries (handoff/failure) before auto-cancel.
    pub max_task_retries: u32,
    /// Whether adaptive retry is enabled for this worker.
    pub adaptive_retry: bool,
    /// Model used for failure analysis when adaptive retry is enabled.
    pub failure_analysis_model: String,
    /// Middleware chain for composable execution behavior (guardrails, cost tracking, etc.).
    pub middleware_chain: Option<Arc<MiddlewareChain>>,
    /// Event broadcaster for real-time execution event streaming.
    pub activity_stream: Option<Arc<ActivityStream>>,
    /// Optional debounced write queue for batching reflection memory writes.
    pub write_queue: Option<Arc<tokio::sync::Mutex<aeqi_ideas::debounce::WriteQueue>>>,
    /// Persistent agent UUID for entity-scoped memory. When set, memory queries
    /// include this agent's entity memories alongside domain/system memories.
    pub persistent_agent_id: Option<String>,
    /// Session store for recording worker transcripts.
    pub session_store: Option<Arc<crate::SessionStore>>,
    /// Agent registry for querying child task outcomes in resume briefs.
    pub agent_registry: Option<Arc<AgentRegistry>>,
    /// Step-level ideas (snapshotted from `session:step_start` events) to
    /// inject before every LLM call. See `docs/design/as-011-worker-step-context.md`.
    pub step_ideas: Vec<aeqi_core::StepIdeaSpec>,
}

impl AgentWorker {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        agent_name: String,
        name: String,
        project_name: String,
        provider: Arc<dyn aeqi_core::traits::Provider>,
        tools: Vec<Arc<dyn Tool>>,
        system_prompt: String,
        model: String,
        activity_log: Arc<ActivityLog>,
    ) -> Self {
        let reflect_model = model.clone();
        Self {
            agent_name,
            name,
            project_name,
            state: WorkerState::Idle,
            hook: None,
            execution: WorkerExecution::Agent {
                provider,
                tools,
                model,
            },
            system_prompt,
            assembled_prompt: None,
            activity_log,
            quest_snapshot: None,
            on_complete: None,
            idea_store: None,
            reflect_provider: None,
            reflect_model,
            project_dir: None,
            max_task_retries: 3,

            adaptive_retry: false,
            failure_analysis_model: String::new(),
            middleware_chain: None,
            activity_stream: None,
            write_queue: None,
            persistent_agent_id: None,
            session_store: None,
            agent_registry: None,
            step_ideas: Vec::new(),
        }
    }

    pub fn new_claude_code(
        agent_name: String,
        name: String,
        project_name: String,
        cwd: PathBuf,
        max_budget_usd: f64,
        system_prompt: String,
        activity_log: Arc<ActivityLog>,
    ) -> Self {
        Self {
            agent_name,
            name,
            project_name,
            state: WorkerState::Idle,
            hook: None,
            execution: WorkerExecution::ClaudeCode {
                cwd,
                max_budget_usd,
            },
            system_prompt,
            assembled_prompt: None,
            activity_log,
            quest_snapshot: None,
            on_complete: None,
            idea_store: None,
            reflect_provider: None,
            reflect_model: String::new(),
            project_dir: None,
            max_task_retries: 3,

            adaptive_retry: false,
            failure_analysis_model: String::new(),
            middleware_chain: None,
            activity_stream: None,
            write_queue: None,
            persistent_agent_id: None,
            session_store: None,
            agent_registry: None,
            step_ideas: Vec::new(),
        }
    }

    pub fn with_agent_registry(mut self, registry: Arc<AgentRegistry>) -> Self {
        self.agent_registry = Some(registry);
        self
    }

    pub fn with_idea_store(mut self, idea_store: Arc<dyn IdeaStore>) -> Self {
        self.idea_store = Some(idea_store);
        self
    }

    pub fn with_reflect(mut self, provider: Arc<dyn Provider>, model: String) -> Self {
        self.reflect_provider = Some(provider);
        self.reflect_model = model;
        self
    }

    pub fn with_project_dir(mut self, project_dir: PathBuf) -> Self {
        self.project_dir = Some(project_dir);
        self
    }

    /// Set the persistent agent UUID for entity-scoped memory.
    pub fn with_persistent_agent(mut self, agent_id: String) -> Self {
        self.persistent_agent_id = Some(agent_id);
        self
    }

    /// Attach step-level ideas snapshotted from `session:step_start` events.
    /// Specs are passed verbatim to `aeqi_core::Agent::with_step_ideas` in
    /// `execute_agent`.
    pub fn with_step_ideas(mut self, specs: Vec<aeqi_core::StepIdeaSpec>) -> Self {
        self.step_ideas = specs;
        self
    }

    pub fn with_max_task_retries(mut self, max_retries: u32) -> Self {
        self.max_task_retries = max_retries;
        self
    }

    pub fn with_adaptive_retry(mut self, model: String) -> Self {
        self.adaptive_retry = true;
        self.failure_analysis_model = model;
        self
    }

    /// Set the middleware chain for this worker.
    pub fn set_middleware(&mut self, chain: MiddlewareChain) {
        self.middleware_chain = Some(Arc::new(chain));
    }

    /// Set the event broadcaster for real-time execution event streaming.
    pub fn set_broadcaster(&mut self, broadcaster: Arc<ActivityStream>) {
        self.activity_stream = Some(broadcaster);
    }

    /// Set the debounced write queue for batching reflection memory writes.
    pub fn set_write_queue(
        &mut self,
        queue: Arc<tokio::sync::Mutex<aeqi_ideas::debounce::WriteQueue>>,
    ) {
        self.write_queue = Some(queue);
    }

    /// Get the working directory for this worker.
    fn workdir(&self) -> Option<&std::path::Path> {
        self.project_dir.as_deref()
    }

    /// Capture an external checkpoint by inspecting git state in the worker's workdir.
    /// Saves the checkpoint to the project's `.aeqi/checkpoints/` directory.
    fn capture_and_save_checkpoint(&self, quest_id: &str, progress_notes: Option<&str>) {
        let Some(workdir) = self.workdir() else {
            debug!(worker = %self.name, "no workdir — skipping checkpoint capture");
            return;
        };

        let project_dir = self.project_dir.as_deref().unwrap_or(workdir);

        match AgentCheckpoint::capture(workdir) {
            Ok(checkpoint) => {
                let checkpoint: AgentCheckpoint = checkpoint
                    .with_quest_id(quest_id)
                    .with_worker_name(&self.agent_name);

                let checkpoint = if let Some(notes) = progress_notes {
                    checkpoint.with_progress_notes(notes)
                } else {
                    checkpoint
                };

                let cp_path = AgentCheckpoint::path_for_quest(project_dir, quest_id);
                if let Err(e) = checkpoint.write(&cp_path) {
                    warn!(
                        worker = %self.name,
                        task = %quest_id,
                        error = %e,
                        "failed to write checkpoint"
                    );
                } else {
                    info!(
                        worker = %self.name,
                        task = %quest_id,
                        files = checkpoint.modified_files.len(),
                        "external checkpoint captured"
                    );
                }
            }
            Err(e) => {
                warn!(
                    worker = %self.name,
                    task = %quest_id,
                    error = %e,
                    "failed to capture git checkpoint"
                );
            }
        }
    }

    /// Assign a quest to this worker (set hook and snapshot the full quest).
    pub fn assign(&mut self, quest: &Quest) {
        self.hook = Some(Hook::new(quest.id.clone(), quest.name.clone()));
        self.quest_snapshot = Some(quest.clone());
        self.state = WorkerState::Hooked;
    }

    /// Save a checkpoint recording this worker's progress on a task.
    /// Now a no-op — the scheduler handles task state through AgentRegistry;
    /// checkpoints written to a throwaway board were lost anyway.
    async fn save_checkpoint(&self, quest_id: &str, progress: &str, _cost: f64, _turns: u32) {
        debug!(
            worker = %self.name,
            task = %quest_id,
            progress = %progress,
            "checkpoint save skipped (scheduler manages task state)"
        );
    }

    async fn build_resume_brief(&self, quest: &Quest) -> String {
        let mut sections = Vec::new();

        {
            let filter = crate::activity_log::EventFilter {
                event_type: Some("decision".to_string()),
                quest_id: Some(quest.id.0.clone()),
                ..Default::default()
            };
            if let Ok(events) = self.activity_log.query(&filter, 6, 0).await
                && !events.is_empty()
            {
                let lines = events
                    .iter()
                    .map(|event| {
                        let decision_type = event
                            .content
                            .get("decision_type")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown");
                        let reasoning = event
                            .content
                            .get("reasoning")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        format!(
                            "- {} [{}] {}",
                            event.created_at.format("%Y-%m-%d %H:%M:%S UTC"),
                            decision_type,
                            truncate_for_prompt(reasoning, 220),
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                sections.push(format!("### Audit trail\n{lines}"));
            }
        }

        // Child task outcomes
        if let Some(ref registry) = self.agent_registry {
            let child_prefix = format!("{}.", quest.id.0);
            let children = registry
                .list_tasks(None, None)
                .await
                .unwrap_or_default()
                .into_iter()
                .filter(|t| {
                    t.id.0.starts_with(&child_prefix) && !t.id.0[child_prefix.len()..].contains('.')
                })
                .collect::<Vec<_>>();

            if !children.is_empty() {
                sections.push("### Child task outcomes".to_string());
                for child in &children {
                    let status = &child.status;
                    let summary = child
                        .outcome
                        .as_ref()
                        .map(|o| o.summary.chars().take(150).collect::<String>())
                        .unwrap_or_default();
                    sections.push(format!(
                        "  {} [{}] {} — {}",
                        child.id, status, child.name, summary
                    ));
                }
            }
        }

        if sections.is_empty() {
            String::new()
        } else {
            format!(
                "\n## Resume Brief\n\n{}\n\nUse this to avoid repeating earlier failures or redundant work.\n",
                sections.join("\n\n")
            )
        }
    }

    /// Execute the hooked work through the native AEQI agent runtime.
    /// Returns (outcome, cost_usd, steps_used) for the Scheduler to record.
    pub async fn execute(&mut self) -> Result<(QuestOutcome, RuntimeExecution, f64, u32)> {
        let hook = match &self.hook {
            Some(h) => h.clone(),
            None => {
                warn!(worker = %self.name, "no hook assigned, nothing to do");
                let runtime_outcome = RuntimeOutcome::done("no work assigned", Vec::new());
                let outcome = QuestOutcome::from_runtime_outcome(&runtime_outcome);
                let mut session = RuntimeSession::new(
                    "unassigned",
                    self.name.clone(),
                    self.project_name.clone(),
                    self.execution_model(),
                );
                session.mark_phase(RuntimePhase::Prime, "Worker had no hook assigned");
                session.finish(&runtime_outcome);
                // Fire on_complete for this early exit path.
                if let Some(cb) = self.on_complete.take() {
                    let outcome_record = Self::build_quest_outcome_record(&runtime_outcome);
                    cb(QuestStatus::Done, Some(outcome_record));
                }
                return Ok((
                    outcome,
                    RuntimeExecution {
                        session,
                        outcome: runtime_outcome,
                    },
                    0.0,
                    0,
                ));
            }
        };

        let execution_start = std::time::Instant::now();
        let mut runtime_session = RuntimeSession::new(
            hook.quest_id.0.clone(),
            self.name.clone(),
            self.project_name.clone(),
            self.execution_model(),
        );
        runtime_session.mark_phase(RuntimePhase::Prime, "Loaded task hook and worker identity");

        // Extract parent_session_id from task labels (set by dispatch consumption).
        let parent_session_id = self.quest_snapshot.as_ref().and_then(|t| {
            t.labels
                .iter()
                .find_map(|l| l.strip_prefix("parent_session_id:"))
                .map(String::from)
        });

        // Create a DB session for this worker execution.
        let worker_session_id = if let Some(ref ss) = self.session_store {
            let quest_id_str = hook.quest_id.0.clone();
            ss.create_session(
                &self.agent_name,
                "task",
                &quest_id_str,
                parent_session_id.as_deref(),
                Some(&quest_id_str),
            )
            .await
            .ok()
        } else {
            None
        };

        // Build WorkerContext for middleware chain.
        let task_description_for_ctx = self
            .quest_snapshot
            .as_ref()
            .map(|t| t.description.clone())
            .unwrap_or_else(|| hook.subject.clone());
        let mut worker_ctx = WorkerContext::new(
            &hook.quest_id.0,
            &task_description_for_ctx,
            &self.agent_name,
            &self.project_name,
        );

        // Run middleware on_start — check for Halt before proceeding.
        if let Some(ref chain) = self.middleware_chain {
            let action = chain.run_on_start(&mut worker_ctx).await;
            match action {
                MiddlewareAction::Halt(reason) => {
                    warn!(
                        worker = %self.name,
                        task = %hook.quest_id,
                        reason = %reason,
                        "middleware halted execution on start"
                    );
                    self.hook = None;
                    runtime_session.mark_phase(
                        RuntimePhase::Frame,
                        "Middleware halted execution before run",
                    );
                    let runtime_outcome =
                        RuntimeOutcome::failed(format!("Middleware halted: {reason}"), Vec::new());
                    let outcome = QuestOutcome::from_runtime_outcome(&runtime_outcome);
                    runtime_session.finish(&runtime_outcome);
                    let runtime_execution = RuntimeExecution {
                        session: runtime_session,
                        outcome: runtime_outcome,
                    };
                    self.persist_runtime_execution(&hook.quest_id.0, &runtime_execution)
                        .await;
                    if let Some(ref broadcaster) = self.activity_stream {
                        broadcaster.publish(Activity::QuestFailed {
                            quest_id: hook.quest_id.0.clone(),
                            reason: reason.clone(),
                            artifacts_preserved: false,
                            runtime: Some(runtime_execution.clone()),
                        });
                    }
                    // Emit budget_exceeded if the halt was budget-related.
                    let reason_lower = reason.to_lowercase();
                    if reason_lower.contains("budget") || reason_lower.contains("cost") {
                        let _ = self
                            .activity_log
                            .emit(
                                "budget_exceeded",
                                None,
                                None,
                                Some(&hook.quest_id.0),
                                &serde_json::json!({
                                    "worker": self.name,
                                    "agent": self.agent_name,
                                    "reason": reason,
                                }),
                            )
                            .await;
                    }
                    // Fire on_complete for this early exit path.
                    if let Some(cb) = self.on_complete.take() {
                        let outcome_record =
                            Self::build_quest_outcome_record(&runtime_execution.outcome);
                        cb(QuestStatus::Pending, Some(outcome_record));
                    }
                    return Ok((outcome, runtime_execution, 0.0, 0));
                }
                MiddlewareAction::Continue
                | MiddlewareAction::Inject(_)
                | MiddlewareAction::Skip => {}
            }
        }

        // Publish QuestStarted event.
        if let Some(ref broadcaster) = self.activity_stream {
            broadcaster.publish(Activity::QuestStarted {
                quest_id: hook.quest_id.0.clone(),
                agent: self.agent_name.clone(),
                project: self.project_name.clone(),
                runtime_session: Some(runtime_session.clone()),
            });
        }

        info!(
            worker = %self.name,
            task = %hook.quest_id,
            subject = %hook.subject,
            mode = "agent",
            "starting work"
        );

        self.state = WorkerState::Working;

        // The scheduler already marks in_progress before spawning — no need to do it here.

        // Use the task snapshot populated at assign() time.
        let quest_snapshot = self.quest_snapshot.clone();

        let mut task_context = match quest_snapshot.as_ref() {
            Some(b) => {
                let mut ctx = format!("## Task: {}\n\n", b.name);
                if !b.description.is_empty() {
                    ctx.push_str(&format!("{}\n\n", b.description));
                }
                ctx.push_str(&format!("Quest ID: {}\nPriority: {}\n", b.id, b.priority));

                // Include budgeted checkpoints from previous attempts.
                if !b.checkpoints.is_empty() {
                    let budget = crate::context_budget::ContextBudget::default();
                    ctx.push_str(&budget.budget_checkpoints(&b.checkpoints));
                    ctx.push_str(
                        "Review the above before starting. Skip work that's already done.\n\n",
                    );
                }

                // Include acceptance criteria if defined.
                if let Some(ref criteria) = b.acceptance_criteria {
                    ctx.push_str(&format!(
                        "\n## Acceptance Criteria\n\n{}\n\n\
                         Verify your work meets these criteria before marking as DONE.\n\n",
                        criteria
                    ));
                }

                ctx
            }
            None => format!("Task: {}", hook.subject),
        };
        // Layer 3: Quest tree context — parent, siblings, and children.
        if let Some(ref task) = quest_snapshot
            && let Some(ref registry) = self.agent_registry
        {
            let tree_ctx = build_quest_tree_context(task, registry).await;
            if !tree_ctx.is_empty() {
                task_context.push_str(&tree_ctx);
            }
        }

        if let Some(task) = quest_snapshot.as_ref() {
            let resume_brief = self.build_resume_brief(task).await;
            if !resume_brief.is_empty() {
                task_context.push_str(&resume_brief);
            }
        }
        runtime_session.mark_phase(
            RuntimePhase::Frame,
            "Prepared task context, checkpoints, and resume brief",
        );

        // Record the task context into the worker session.
        if let (Some(ss), Some(sid)) = (&self.session_store, &worker_session_id) {
            let _ = ss
                .record_by_session(sid, "user", &task_context, Some("worker"))
                .await;
        }

        // Context flows only through events → ideas. No silent recall, no
        // mid-loop memory prefetch — if a user wants context injected, they
        // configure an event with idea_ids or a query_template, which runs
        // through idea_assembly and emits a visible transcript event.
        let enriched_system_prompt = self.system_prompt.clone();
        runtime_session.mark_phase(
            RuntimePhase::Act,
            format!(
                "Executing native AEQI agent loop{}",
                self.execution_model()
                    .map(|model| format!(" with model {model}"))
                    .unwrap_or_default()
            ),
        );
        self.persist_runtime_session(&hook.quest_id.0, &runtime_session)
            .await;

        // Dispatch based on execution mode. Returns (text, cost_usd, steps_used).
        let raw_result = match &self.execution {
            WorkerExecution::Agent {
                provider,
                tools,
                model,
            } => self
                .execute_agent(
                    provider.clone(),
                    tools.clone(),
                    model,
                    &task_context,
                    &enriched_system_prompt,
                    worker_session_id.as_deref(),
                )
                .await
                .map(|agent_result| {
                    let cost = aeqi_providers::estimate_cost(
                        &agent_result.model,
                        agent_result.total_prompt_tokens,
                        agent_result.total_completion_tokens,
                    );
                    info!(
                        worker = %self.name,
                        model = %agent_result.model,
                        prompt_tokens = agent_result.total_prompt_tokens,
                        completion_tokens = agent_result.total_completion_tokens,
                        cost_usd = cost,
                        iterations = agent_result.iterations,
                        "agent execution cost calculated"
                    );
                    (agent_result.text, cost, agent_result.iterations)
                }),
            WorkerExecution::ClaudeCode {
                cwd,
                max_budget_usd,
            } => {
                info!(
                    worker = %self.name,
                    cwd = %cwd.display(),
                    budget = max_budget_usd,
                    "dispatching to claude code"
                );
                let executor = crate::claude_code::ClaudeCodeExecutor::new(cwd.clone())
                    .with_budget(*max_budget_usd);
                // Pass the enriched system prompt (persona, memory, blackboard,
                // resume brief) to Claude Code.
                executor
                    .execute_with_identity(&enriched_system_prompt, &task_context)
                    .await
                    .map(|cc_result| {
                        info!(
                            worker = %self.name,
                            model = %cc_result.model,
                            cost_usd = cc_result.cost_usd,
                            steps = cc_result.num_steps,
                            session = %cc_result.session_id,
                            "claude code execution complete"
                        );
                        (cc_result.text, cc_result.cost_usd, cc_result.num_steps)
                    })
            }
        };

        // Record the agent result into the worker session.
        if let (Some(ss), Some(sid)) = (&self.session_store, &worker_session_id) {
            let content = match &raw_result {
                Ok((text, _, _)) => text.clone(),
                Err(e) => format!("ERROR: {e}"),
            };
            let _ = ss
                .record_by_session(sid, "assistant", &content, Some("worker"))
                .await;
        }

        // Parse into structured outcome.
        let runtime_artifacts = self.collect_runtime_artifacts();
        let (outcome, mut runtime_outcome, cost, steps) = match raw_result {
            Ok((result_text, cost, steps)) => {
                let runtime_outcome =
                    RuntimeOutcome::from_agent_response(&result_text, runtime_artifacts);
                let outcome = QuestOutcome::from_runtime_outcome(&runtime_outcome);
                (outcome, runtime_outcome, cost, steps)
            }
            Err(e) => {
                // Run middleware on_error.
                if let Some(ref chain) = self.middleware_chain {
                    let error_str = e.to_string();
                    chain.run_on_error(&mut worker_ctx, &error_str).await;
                }
                let runtime_outcome = RuntimeOutcome::failed(e.to_string(), runtime_artifacts);
                let outcome = QuestOutcome::from_runtime_outcome(&runtime_outcome);
                (outcome, runtime_outcome, 0.0, 0)
            }
        };
        let runtime_artifact_refs = runtime_outcome.artifact_refs();
        runtime_session.mark_phase(
            RuntimePhase::Verify,
            "Captured runtime artifacts and prepared structured outcome",
        );

        // Run middleware on_complete with structured outcome.
        let duration_ms = execution_start.elapsed().as_millis() as u64;
        if let Some(ref chain) = self.middleware_chain {
            let mw_outcome = match &outcome {
                QuestOutcome::Done(_) => Outcome {
                    status: OutcomeStatus::Done,
                    confidence: 1.0,
                    artifacts: runtime_artifact_refs.clone(),
                    cost_usd: cost,
                    steps,
                    duration_ms,
                    reason: None,
                    runtime: Some(runtime_outcome.clone()),
                },
                QuestOutcome::Blocked { question, .. } => Outcome {
                    status: OutcomeStatus::Blocked,
                    confidence: 0.5,
                    artifacts: runtime_artifact_refs.clone(),
                    cost_usd: cost,
                    steps,
                    duration_ms,
                    reason: Some(question.clone()),
                    runtime: Some(runtime_outcome.clone()),
                },
                QuestOutcome::Handoff { checkpoint } => Outcome {
                    status: OutcomeStatus::NeedsContext,
                    confidence: 0.3,
                    artifacts: runtime_artifact_refs.clone(),
                    cost_usd: cost,
                    steps,
                    duration_ms,
                    reason: Some(checkpoint.clone()),
                    runtime: Some(runtime_outcome.clone()),
                },
                QuestOutcome::Failed(error) => Outcome {
                    status: OutcomeStatus::Failed,
                    confidence: 0.0,
                    artifacts: runtime_artifact_refs.clone(),
                    cost_usd: cost,
                    steps,
                    duration_ms,
                    reason: Some(error.clone()),
                    runtime: Some(runtime_outcome.clone()),
                },
            };
            worker_ctx.cost_usd = cost;
            chain.run_on_complete(&mut worker_ctx, &mw_outcome).await;
        }

        // Process outcome: save checkpoint, determine final task status.
        // `final_task_status` is used by the on_complete callback below.
        let final_task_status;
        match &outcome {
            QuestOutcome::Done(result_text) => {
                info!(worker = %self.name, task = %hook.quest_id, "work completed");
                // Capture external checkpoint from git state before recording completion.
                self.capture_and_save_checkpoint(
                    &hook.quest_id.0,
                    Some(&format!("DONE: {}", result_text)),
                );
                self.save_checkpoint(
                    &hook.quest_id.0,
                    &format!("DONE: {}", result_text),
                    cost,
                    steps,
                )
                .await;
                final_task_status = QuestStatus::Done;
                self.state = WorkerState::Done;
            }

            QuestOutcome::Blocked {
                question,
                full_text,
            } => {
                info!(
                    worker = %self.name,
                    task = %hook.quest_id,
                    question = %question,
                    "worker blocked — needs input"
                );
                // Capture external checkpoint from git state before recording block.
                self.capture_and_save_checkpoint(
                    &hook.quest_id.0,
                    Some(&format!(
                        "BLOCKED: {}\n\nWork so far:\n{}",
                        question, full_text
                    )),
                );
                self.save_checkpoint(
                    &hook.quest_id.0,
                    &format!(
                        "BLOCKED on: {}\n\nWork done so far:\n{}",
                        question, full_text
                    ),
                    cost,
                    steps,
                )
                .await;
                final_task_status = QuestStatus::Blocked;
                self.state = WorkerState::Done; // Worker is done; task is blocked.
            }

            QuestOutcome::Handoff { checkpoint } => {
                info!(worker = %self.name, task = %hook.quest_id, "worker handing off — context exhaustion");
                // Capture external checkpoint from git state before recording handoff.
                self.capture_and_save_checkpoint(
                    &hook.quest_id.0,
                    Some(&format!("HANDOFF: {}", checkpoint)),
                );
                self.save_checkpoint(
                    &hook.quest_id.0,
                    &format!("HANDOFF: {}", checkpoint),
                    cost,
                    steps,
                )
                .await;
                // Check if this handoff would exceed max retries.
                let current_retry = self
                    .quest_snapshot
                    .as_ref()
                    .map(|t| t.retry_count)
                    .unwrap_or(0);
                if current_retry + 1 >= self.max_task_retries {
                    final_task_status = QuestStatus::Cancelled;
                    warn!(
                        worker = %self.name,
                        task = %hook.quest_id,
                        retries = current_retry + 1,
                        "quest auto-cancelled after max retries (handoff)"
                    );
                } else {
                    final_task_status = QuestStatus::Pending;
                }
                self.state = WorkerState::Done;
            }

            QuestOutcome::Failed(error_text) => {
                warn!(worker = %self.name, task = %hook.quest_id, "work failed");
                // Capture external checkpoint from git state before recording failure.
                self.capture_and_save_checkpoint(
                    &hook.quest_id.0,
                    Some(&format!("FAILED: {}", error_text)),
                );
                self.save_checkpoint(
                    &hook.quest_id.0,
                    &format!("FAILED: {}", error_text),
                    cost,
                    steps,
                )
                .await;

                // Attempt LLM-based failure analysis.
                let failure_result: Option<(String, FailureMode)> = if self.adaptive_retry
                    && let Some(ref provider) = self.reflect_provider
                {
                    let fa_model = if self.failure_analysis_model.is_empty() {
                        self.reflect_model.clone()
                    } else {
                        self.failure_analysis_model.clone()
                    };
                    if !fa_model.is_empty() {
                        let (task_desc, _task_labels) = self
                            .quest_snapshot
                            .as_ref()
                            .map(|t| (t.description.clone(), t.labels.clone()))
                            .unwrap_or_default();
                        let prompt =
                            FailureAnalysis::analysis_prompt(&hook.subject, &task_desc, error_text);
                        let request = ChatRequest {
                            model: fa_model,
                            messages: vec![Message {
                                role: Role::User,
                                content: MessageContent::text(&prompt),
                            }],
                            tools: vec![],
                            max_tokens: 256,
                            temperature: 0.0,
                        };
                        match provider.chat(&request).await {
                            Ok(response) if response.content.is_some() => {
                                let analysis = FailureAnalysis::parse(
                                    response.content.as_deref().unwrap_or_default(),
                                );
                                info!(
                                    worker = %self.name,
                                    task = %hook.quest_id,
                                    mode = ?analysis.mode,
                                    "failure analysis completed"
                                );

                                // Record decision event.
                                let _ = self
                                    .activity_log
                                    .emit(
                                        "decision",
                                        None,
                                        None,
                                        Some(&hook.quest_id.0),
                                        &serde_json::json!({
                                            "decision_type": "FailureAnalyzed",
                                            "agent": self.agent_name,
                                            "reasoning": format!(
                                                "Mode: {:?}, Reasoning: {}",
                                                analysis.mode, analysis.reasoning
                                            ),
                                        }),
                                    )
                                    .await;

                                let enrichment = analysis.enrich_description();

                                let mode = analysis.mode;
                                Some((enrichment, mode))
                            }
                            Ok(_) | Err(_) => None,
                        }
                    } else {
                        None
                    }
                } else {
                    None
                };

                // Determine auto-cancel from task snapshot retry_count.
                let current_retry = self
                    .quest_snapshot
                    .as_ref()
                    .map(|t| t.retry_count)
                    .unwrap_or(0);
                let auto_cancelled = current_retry + 1 >= self.max_task_retries;
                let failure_mode = failure_result.as_ref().map(|(_, m)| *m);
                // Also treat ExternalBlocker / BudgetExhausted as terminal.
                let is_blocker = matches!(
                    failure_mode,
                    Some(FailureMode::ExternalBlocker) | Some(FailureMode::BudgetExhausted)
                );

                if auto_cancelled {
                    final_task_status = QuestStatus::Cancelled;
                    warn!(
                        worker = %self.name,
                        task = %hook.quest_id,
                        retries = current_retry + 1,
                        "quest auto-cancelled after max retries"
                    );
                    let _ = self.activity_log.emit(
                        "decision",
                        None,
                        None,
                        Some(&hook.quest_id.0),
                        &serde_json::json!({
                            "decision_type": "TaskCancelled",
                            "agent": self.agent_name,
                            "reasoning": format!("Auto-cancelled after max retries: {}", error_text),
                        }),
                    ).await;
                } else if is_blocker {
                    final_task_status = QuestStatus::Blocked;
                    warn!(
                        worker = %self.name,
                        task = %hook.quest_id,
                        mode = ?failure_mode,
                        "quest blocked by failure analysis"
                    );
                } else {
                    final_task_status = QuestStatus::Pending;
                }
                self.state = WorkerState::Failed(error_text.to_string());
            }
        }

        // Close the worker session now that the outcome is determined.
        if let (Some(ss), Some(sid)) = (&self.session_store, &worker_session_id) {
            let _ = ss.close_session(sid).await;
        }

        if let Some(checkpoint_path) = self.checkpoint_path_for_quest(&hook.quest_id.0)
            && checkpoint_path.exists()
        {
            let checkpoint_ref = checkpoint_path.display().to_string();
            runtime_session.add_checkpoint_ref(checkpoint_ref.clone());
            runtime_outcome.artifacts.push(Artifact::new(
                ArtifactKind::Checkpoint,
                "checkpoint",
                checkpoint_ref,
            ));
        }
        runtime_session.finish(&runtime_outcome);
        let runtime_execution = RuntimeExecution {
            session: runtime_session.clone(),
            outcome: runtime_outcome.clone(),
        };
        self.persist_runtime_execution(&hook.quest_id.0, &runtime_execution)
            .await;

        // Publish outcome-specific execution events with the finalized runtime state.
        if let Some(ref broadcaster) = self.activity_stream {
            match &outcome {
                QuestOutcome::Done(summary) => {
                    broadcaster.publish(Activity::QuestCompleted {
                        quest_id: hook.quest_id.0.clone(),
                        outcome: summary.chars().take(500).collect(),
                        confidence: 1.0,
                        cost_usd: cost,
                        steps,
                        duration_ms,
                        runtime: Some(runtime_execution.clone()),
                    });
                }
                QuestOutcome::Blocked { question, .. } => {
                    broadcaster.publish(Activity::ClarificationNeeded {
                        quest_id: hook.quest_id.0.clone(),
                        question: question.clone(),
                        options: Vec::new(),
                        runtime: Some(runtime_execution.clone()),
                    });
                }
                QuestOutcome::Handoff { checkpoint } => {
                    broadcaster.publish(Activity::CheckpointCreated {
                        quest_id: hook.quest_id.0.clone(),
                        message: format!(
                            "HANDOFF: {}",
                            checkpoint.chars().take(500).collect::<String>()
                        ),
                        runtime: Some(runtime_execution.clone()),
                    });
                }
                QuestOutcome::Failed(reason) => {
                    broadcaster.publish(Activity::QuestFailed {
                        quest_id: hook.quest_id.0.clone(),
                        reason: reason.chars().take(500).collect(),
                        artifacts_preserved: !runtime_execution.outcome.artifacts.is_empty(),
                        runtime: Some(runtime_execution.clone()),
                    });
                }
            }
        }

        // Fire the on_complete callback with the final status and outcome record.
        if let Some(cb) = self.on_complete.take() {
            let final_record = if final_task_status == QuestStatus::Done {
                Some(Self::build_quest_outcome_record(&runtime_execution.outcome))
            } else {
                None
            };
            cb(final_task_status, final_record);
        }

        self.hook = None;
        Ok((outcome, runtime_execution, cost, steps))
    }

    fn execution_model(&self) -> Option<String> {
        match &self.execution {
            WorkerExecution::Agent { model, .. } => Some(model.clone()),
            WorkerExecution::ClaudeCode { .. } => Some("claude-code".to_string()),
        }
    }

    async fn persist_runtime_session(&self, quest_id: &str, session: &RuntimeSession) {
        self.persist_runtime_value(
            quest_id,
            serde_json::json!({
                "session": session,
                "outcome": serde_json::Value::Null,
            }),
        )
        .await;
    }

    async fn persist_runtime_execution(&self, quest_id: &str, runtime: &RuntimeExecution) {
        match serde_json::to_value(runtime) {
            Ok(value) => {
                self.persist_runtime_value(quest_id, value).await;
                self.persist_quest_outcome(quest_id, &runtime.outcome).await;
            }
            Err(error) => warn!(
                worker = %self.name,
                task = %quest_id,
                error = %error,
                "failed to serialize runtime execution for task metadata"
            ),
        }
    }

    async fn persist_runtime_value(&self, quest_id: &str, _runtime: serde_json::Value) {
        // No-op — was writing to a throwaway board. Runtime metadata now flows
        // through the on_complete callback and the scheduler.
        debug!(
            worker = %self.name,
            task = %quest_id,
            "runtime value persist skipped (scheduler manages task state)"
        );
    }

    /// Build a QuestOutcomeRecord from a RuntimeOutcome (used by on_complete callback).
    fn build_quest_outcome_record(outcome: &RuntimeOutcome) -> QuestOutcomeRecord {
        QuestOutcomeRecord {
            kind: Self::quest_outcome_kind(outcome),
            summary: outcome.summary.clone(),
            reason: outcome.reason.clone(),
            next_action: outcome.next_action.clone(),
        }
    }

    async fn persist_quest_outcome(&self, quest_id: &str, outcome: &RuntimeOutcome) {
        // The outcome record now flows through the on_complete callback.
        debug!(
            worker = %self.name,
            task = %quest_id,
            kind = ?Self::quest_outcome_kind(outcome),
            "quest outcome persist skipped (delivered via on_complete callback)"
        );
    }

    fn quest_outcome_kind(outcome: &RuntimeOutcome) -> QuestOutcomeKind {
        match outcome.status {
            crate::runtime::RuntimeOutcomeStatus::Done => QuestOutcomeKind::Done,
            crate::runtime::RuntimeOutcomeStatus::Blocked => QuestOutcomeKind::Blocked,
            crate::runtime::RuntimeOutcomeStatus::Handoff => QuestOutcomeKind::Handoff,
            crate::runtime::RuntimeOutcomeStatus::Failed => QuestOutcomeKind::Failed,
        }
    }

    fn checkpoint_path_for_quest(&self, quest_id: &str) -> Option<PathBuf> {
        self.project_dir
            .as_deref()
            .or(self.workdir())
            .map(|project_dir| AgentCheckpoint::path_for_quest(project_dir, quest_id))
    }

    fn collect_runtime_artifacts(&self) -> Vec<Artifact> {
        let Some(workdir) = self.workdir() else {
            return Vec::new();
        };

        let checkpoint = match AgentCheckpoint::capture(workdir) {
            Ok(checkpoint) => checkpoint,
            Err(error) => {
                debug!(
                    worker = %self.name,
                    error = %error,
                    "failed to collect runtime artifacts from git state"
                );
                return Vec::new();
            }
        };

        let mut artifacts = Vec::new();

        if let Some(ref worktree) = checkpoint.worktree_path {
            artifacts.push(Artifact::new(ArtifactKind::Worktree, "worktree", worktree));
        }
        if let Some(ref branch) = checkpoint.branch {
            artifacts.push(Artifact::new(ArtifactKind::GitBranch, "branch", branch));
        }
        if let Some(ref commit) = checkpoint.last_commit {
            artifacts.push(Artifact::new(ArtifactKind::GitCommit, "head", commit));
        }
        for file in checkpoint.modified_files {
            artifacts.push(Artifact::new(ArtifactKind::File, file.clone(), file));
        }

        artifacts
    }

    async fn execute_agent(
        &self,
        provider: Arc<dyn aeqi_core::traits::Provider>,
        tools: Vec<Arc<dyn Tool>>,
        model: &str,
        task_context: &str,
        system_prompt: &str,
        worker_session_id: Option<&str>,
    ) -> Result<aeqi_core::AgentResult> {
        // Load user-defined hook rules from <project_dir>/.aeqi/hooks/*.md.
        let hooks_observer = if let Some(ref dir) = self.project_dir {
            aeqi_core::HooksObserver::load(dir, self.persistent_agent_id.clone()).await
        } else {
            aeqi_core::HooksObserver::from_rules(Vec::new(), None)
        };

        let base_observer: Arc<dyn Observer> = if let Some(ref chain) = self.middleware_chain {
            let mut worker_ctx = crate::middleware::WorkerContext::new(
                self.hook
                    .as_ref()
                    .map(|h| h.quest_id.0.as_str())
                    .unwrap_or("unknown"),
                task_context.chars().take(500).collect::<String>(),
                &self.agent_name,
                &self.project_name,
            );
            // Signal to ContextCompressionMiddleware that the agent loop handles compaction.
            worker_ctx.agent_compaction_active = true;
            if let WorkerExecution::Agent { ref model, .. } = self.execution {
                worker_ctx.model = model.clone();
            }
            Arc::new(MiddlewareObserver::from_arc(
                Arc::clone(chain),
                worker_ctx,
                Arc::new(LogObserver),
            ))
        } else {
            Arc::new(LogObserver)
        };

        let observer: Arc<dyn Observer> =
            Arc::new(CompositeObserver::new(hooks_observer, base_observer));

        // Resolve context window from model name.
        let context_window = aeqi_providers::context_window_for_model(model);

        // Resolve persist_dir: use project dir's .aeqi/persist/{worker}, or temp on demand.
        let persist_dir = self.project_dir.as_ref().map(|dir| {
            let p = dir.join(".aeqi").join("persist").join(&self.name);
            if !p.exists() {
                let _ = std::fs::create_dir_all(&p);
            }
            p
        });

        // Resolve session file for checkpoint/resume.
        let session_file = self.project_dir.as_ref().map(|dir| {
            let quest_id = self
                .hook
                .as_ref()
                .map(|h| h.quest_id.0.as_str())
                .unwrap_or("unknown");
            dir.join(".aeqi")
                .join("sessions")
                .join(format!("{}.json", quest_id))
        });

        let agent_config = AgentConfig {
            model: model.to_string(),
            max_iterations: 20,
            name: self.agent_name.clone(),
            context_window,
            persist_dir,
            session_file,
            ..Default::default()
        };

        let mut agent = Agent::new(
            agent_config,
            provider,
            tools,
            observer,
            system_prompt.to_string(),
        );

        if !self.step_ideas.is_empty() {
            agent = agent.with_step_ideas(self.step_ideas.clone());
        }

        if let Some(ref mem) = self.idea_store {
            agent = agent.with_idea_store(mem.clone());
        }

        // Wire chat stream: subscribe in a background task that both forwards
        // events to the ActivityStream (for live UI) and persists ToolComplete
        // events into session_messages so tool_traces_for_quest can feed the
        // candidate-skill pipeline on quest completion.
        let broadcaster = self.activity_stream.clone();
        let session_store = self.session_store.clone();
        let persist_session_id = worker_session_id.map(str::to_string);
        if broadcaster.is_some() || (session_store.is_some() && persist_session_id.is_some()) {
            let quest_id = self
                .hook
                .as_ref()
                .map(|h| h.quest_id.0.clone())
                .unwrap_or_default();
            let (sender, mut rx) = aeqi_core::ChatStreamSender::new(512);
            tokio::spawn(async move {
                while let Ok(event) = rx.recv().await {
                    if let (Some(ss), Some(sid)) = (&session_store, &persist_session_id) {
                        persist_tool_complete(ss, sid, &event).await;
                    }
                    if let Some(ref bc) = broadcaster {
                        bc.publish(crate::activity::Activity::ChatStream {
                            quest_id: quest_id.clone(),
                            chat_id: 0,
                            event,
                        });
                    }
                }
            });
            agent = agent.with_chat_stream(sender);
        }

        agent.run(task_context).await
    }
}

fn truncate_for_prompt(text: &str, max_chars: usize) -> String {
    let mut out = text.chars().take(max_chars).collect::<String>();
    if text.chars().count() > max_chars {
        out.push_str("...");
    }
    out
}

// ---------------------------------------------------------------------------
// MiddlewareObserver — bridges the middleware chain into the agent loop
// ---------------------------------------------------------------------------

use crate::middleware::{ToolCall as MwToolCall, ToolResult as MwToolResult};

struct MiddlewareObserver {
    chain: Arc<MiddlewareChain>,
    ctx: tokio::sync::Mutex<WorkerContext>,
    inner: Arc<dyn Observer>,
    /// The serialized input of the most recent `before_tool` call.
    /// `after_tool` reads this so the middleware chain (e.g. loop detection)
    /// sees the real arguments — the Observer trait's `after_tool` signature
    /// does not carry input, so without this stash every call hashes to the
    /// same fingerprint and collides regardless of arguments.
    last_tool_input: tokio::sync::Mutex<String>,
}

impl MiddlewareObserver {
    fn from_arc(chain: Arc<MiddlewareChain>, ctx: WorkerContext, inner: Arc<dyn Observer>) -> Self {
        Self {
            chain,
            ctx: tokio::sync::Mutex::new(ctx),
            inner,
            last_tool_input: tokio::sync::Mutex::new(String::new()),
        }
    }

    fn map_action(action: MiddlewareAction) -> LoopAction {
        match action {
            MiddlewareAction::Continue | MiddlewareAction::Skip => LoopAction::Continue,
            MiddlewareAction::Halt(reason) => LoopAction::Halt(reason),
            MiddlewareAction::Inject(msgs) => LoopAction::Inject(msgs),
        }
    }
}

#[async_trait::async_trait]
impl Observer for MiddlewareObserver {
    async fn record(&self, event: Event) {
        self.inner.record(event).await;
    }

    fn name(&self) -> &str {
        "middleware-bridge"
    }

    async fn before_model(&self, _iteration: u32) -> LoopAction {
        let mut ctx = self.ctx.lock().await;
        Self::map_action(self.chain.run_before_model(&mut ctx).await)
    }

    async fn after_model(
        &self,
        _iteration: u32,
        prompt_tokens: u32,
        completion_tokens: u32,
    ) -> LoopAction {
        let mut ctx = self.ctx.lock().await;
        ctx.cost_usd += aeqi_providers::estimate_cost(&ctx.model, prompt_tokens, completion_tokens);
        Self::map_action(self.chain.run_after_model(&mut ctx).await)
    }

    async fn before_tool(&self, tool_name: &str, input: &serde_json::Value) -> LoopAction {
        let input_str = input.to_string();
        *self.last_tool_input.lock().await = input_str.clone();
        let mut ctx = self.ctx.lock().await;
        let call = MwToolCall {
            name: tool_name.to_string(),
            input: input_str,
        };
        Self::map_action(self.chain.run_before_tool(&mut ctx, &call).await)
    }

    async fn after_tool(&self, tool_name: &str, output: &str, is_error: bool) -> LoopAction {
        let input = self.last_tool_input.lock().await.clone();
        let mut ctx = self.ctx.lock().await;
        let call = MwToolCall {
            name: tool_name.to_string(),
            input,
        };
        let result = MwToolResult {
            success: !is_error,
            output: output.chars().take(500).collect(),
        };
        ctx.tool_call_history.push(call.clone());
        Self::map_action(self.chain.run_after_tool(&mut ctx, &call, &result).await)
    }

    async fn on_error(&self, _iteration: u32, error: &str) -> LoopAction {
        let mut ctx = self.ctx.lock().await;
        Self::map_action(self.chain.run_on_error(&mut ctx, error).await)
    }

    async fn after_step(
        &self,
        _iteration: u32,
        response_text: &str,
        stop_reason: &str,
    ) -> LoopAction {
        let mut ctx = self.ctx.lock().await;
        Self::map_action(
            self.chain
                .run_after_step(&mut ctx, response_text, stop_reason)
                .await,
        )
    }

    async fn collect_attachments(
        &self,
        _iteration: u32,
    ) -> Vec<aeqi_core::traits::ContextAttachment> {
        let mut ctx = self.ctx.lock().await;
        self.chain.run_collect_enrichments(&mut ctx).await
    }
}

// ---------------------------------------------------------------------------
// Quest Tree Context
// ---------------------------------------------------------------------------

/// Build a markdown snippet showing the current quest's position in the task tree.
///
/// Visibility rule: one up (parent), one down (children), sideways (siblings).
/// - Parent: always shown with truncated description (first 200 chars).
/// - Children: shown with status + outcome summary (one line each).
/// - Done siblings: shown with outcome summary so agent knows what's been built.
/// - In-progress/pending siblings: shown with just status (no details).
/// - No grandparents, no grandchildren.
///
/// Token budget: ~1700 tokens. Descriptions truncated to 200 chars, outcome
/// summaries to 100 chars. If >10 siblings, show top 5 done + top 3 active.
pub async fn build_quest_tree_context(quest: &Quest, registry: &AgentRegistry) -> String {
    let quest_id = &quest.id;

    // 1. Parent quest.
    let parent = if let Some(ref pid) = quest_id.parent() {
        match registry.get_task(&pid.0).await {
            Ok(Some(p)) => Some(p),
            _ => None,
        }
    } else {
        None
    };

    // 2. Children: direct children of this quest.
    let children = registry
        .list_tasks_by_prefix(&quest_id.0)
        .await
        .unwrap_or_default();

    // 3. Siblings: direct children of the parent (excluding self).
    let siblings = if let Some(ref pid) = quest_id.parent() {
        registry
            .list_tasks_by_prefix(&pid.0)
            .await
            .unwrap_or_default()
            .into_iter()
            .filter(|q| q.id != *quest_id)
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    // Partition siblings into done vs active (in_progress/pending/blocked).
    let mut done_siblings: Vec<&Quest> = siblings
        .iter()
        .filter(|q| q.status == QuestStatus::Done)
        .collect();
    let mut active_siblings: Vec<&Quest> = siblings
        .iter()
        .filter(|q| !q.is_closed() && q.status != QuestStatus::Done)
        .collect();

    // Sort done siblings by ID for stable ordering.
    done_siblings.sort_by(|a, b| a.id.0.cmp(&b.id.0));
    active_siblings.sort_by(|a, b| a.id.0.cmp(&b.id.0));

    // Apply sibling caps: max 5 done + 3 active if >10 total siblings.
    let done_capped = siblings.len() > 10;
    let done_overflow = if done_capped && done_siblings.len() > 5 {
        let overflow = done_siblings.len() - 5;
        done_siblings.truncate(5);
        overflow
    } else {
        0
    };

    let active_capped = siblings.len() > 10;
    let active_overflow = if active_capped && active_siblings.len() > 3 {
        let overflow = active_siblings.len() - 3;
        active_siblings.truncate(3);
        overflow
    } else {
        0
    };

    // If there's nothing to show, return empty.
    if parent.is_none() && children.is_empty() && siblings.is_empty() {
        return String::new();
    }

    // 4. Render.
    let mut out = String::from("\n## Quest Tree\n\n");

    // Parent.
    if let Some(ref p) = parent {
        let desc = truncate_str(&p.description, 200);
        out.push_str(&format!("Parent: {} [{}] — {}\n", p.id, p.status, p.name));
        if !desc.is_empty() {
            out.push_str(&format!("  Description: {}\n", desc));
        }
        out.push('\n');
    }

    // Done siblings.
    if !done_siblings.is_empty() {
        out.push_str("Siblings (done):\n");
        for sib in &done_siblings {
            let summary = sib
                .outcome_summary()
                .map(|s| format!(" → \"{}\"", truncate_str(&s, 100)))
                .unwrap_or_default();
            out.push_str(&format!("  {} [done] — {}{}\n", sib.id, sib.name, summary));
        }
        if done_overflow > 0 {
            out.push_str(&format!(
                "  ... and {} more done siblings (use recall for details)\n",
                done_overflow
            ));
        }
        out.push('\n');
    }

    // Active siblings (in_progress, pending, blocked — status only, no details).
    if !active_siblings.is_empty() {
        out.push_str("Siblings (active):\n");
        for sib in &active_siblings {
            out.push_str(&format!("  {} [{}] — {}\n", sib.id, sib.status, sib.name));
        }
        if active_overflow > 0 {
            out.push_str(&format!(
                "  ... and {} more active siblings\n",
                active_overflow
            ));
        }
        out.push('\n');
    }

    // Self marker.
    out.push_str(&format!(
        "You: {} [{}] — {}\n\n",
        quest.id, quest.status, quest.name
    ));

    // Children.
    if !children.is_empty() {
        out.push_str("Children:\n");
        for child in &children {
            let summary = if child.status == QuestStatus::Done {
                child
                    .outcome_summary()
                    .map(|s| format!(" → \"{}\"", truncate_str(&s, 100)))
                    .unwrap_or_default()
            } else {
                String::new()
            };
            out.push_str(&format!(
                "  {} [{}] — {}{}\n",
                child.id, child.status, child.name, summary
            ));
        }
        out.push('\n');
    }

    out
}

/// Truncate a string to at most `max_chars` characters, appending "..." if truncated.
fn truncate_str(s: &str, max_chars: usize) -> String {
    let s = s.trim();
    if s.len() <= max_chars {
        s.to_string()
    } else {
        // Find a safe char boundary.
        let mut end = max_chars;
        while !s.is_char_boundary(end) && end > 0 {
            end -= 1;
        }
        format!("{}...", &s[..end])
    }
}

// ---------------------------------------------------------------------------
// CompositeObserver — chains two observers, hooks fires first
// ---------------------------------------------------------------------------

/// Chains a [`HooksObserver`] (user hook rules) in front of an existing observer.
///
/// For `before_tool` / `after_tool`: if hooks returns `Halt` or `Inject`, that
/// result is returned immediately without calling the inner observer. For
/// `Continue`, the inner observer is consulted.
///
/// All other lifecycle methods delegate only to the inner observer.
struct CompositeObserver {
    hooks: aeqi_core::HooksObserver,
    inner: Arc<dyn Observer>,
}

impl CompositeObserver {
    fn new(hooks: aeqi_core::HooksObserver, inner: Arc<dyn Observer>) -> Self {
        Self { hooks, inner }
    }
}

#[async_trait::async_trait]
impl Observer for CompositeObserver {
    fn name(&self) -> &str {
        "composite"
    }

    async fn record(&self, event: Event) {
        self.inner.record(event).await;
    }

    async fn before_model(&self, iteration: u32) -> LoopAction {
        self.inner.before_model(iteration).await
    }

    async fn after_model(
        &self,
        iteration: u32,
        prompt_tokens: u32,
        completion_tokens: u32,
    ) -> LoopAction {
        self.inner
            .after_model(iteration, prompt_tokens, completion_tokens)
            .await
    }

    async fn before_tool(&self, tool_name: &str, input: &serde_json::Value) -> LoopAction {
        let hook_action = self.hooks.before_tool(tool_name, input).await;
        match hook_action {
            LoopAction::Continue => self.inner.before_tool(tool_name, input).await,
            other => other,
        }
    }

    async fn after_tool(&self, tool_name: &str, output: &str, is_error: bool) -> LoopAction {
        let hook_action = self.hooks.after_tool(tool_name, output, is_error).await;
        match hook_action {
            LoopAction::Continue => self.inner.after_tool(tool_name, output, is_error).await,
            other => other,
        }
    }

    async fn on_error(&self, iteration: u32, error: &str) -> LoopAction {
        self.inner.on_error(iteration, error).await
    }

    async fn after_step(
        &self,
        iteration: u32,
        response_text: &str,
        stop_reason: &str,
    ) -> LoopAction {
        self.inner
            .after_step(iteration, response_text, stop_reason)
            .await
    }

    async fn collect_attachments(
        &self,
        iteration: u32,
    ) -> Vec<aeqi_core::traits::ContextAttachment> {
        self.inner.collect_attachments(iteration).await
    }
}

/// Persist a ToolComplete event into session_messages against the given
/// worker session_id so tool_traces_for_quest can feed the candidate-skill
/// pipeline on quest completion. Non-ToolComplete events are ignored.
async fn persist_tool_complete(
    session_store: &Arc<crate::session_store::SessionStore>,
    session_id: &str,
    event: &aeqi_core::ChatStreamEvent,
) {
    let aeqi_core::ChatStreamEvent::ToolComplete {
        tool_use_id,
        tool_name,
        success,
        input_preview,
        output_preview,
        duration_ms,
    } = event
    else {
        return;
    };
    let meta = serde_json::json!({
        "tool_use_id": tool_use_id,
        "tool_name": tool_name,
        "success": success,
        "input_preview": input_preview,
        "output_preview": output_preview,
        "duration_ms": duration_ms,
    });
    let _ = session_store
        .record_event_by_session(
            session_id,
            "tool_complete",
            "system",
            tool_name,
            Some("worker"),
            Some(&meta),
        )
        .await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session_store::SessionStore;

    async fn test_store() -> Arc<SessionStore> {
        let pool = crate::agent_registry::ConnectionPool::in_memory().unwrap();
        {
            let conn = pool.lock().await;
            SessionStore::create_tables(&conn).unwrap();
        }
        Arc::new(SessionStore::new(Arc::new(pool)))
    }

    #[tokio::test]
    async fn persist_tool_complete_writes_row_feeding_tool_traces_for_quest() {
        let store = test_store().await;
        let quest_id = "as-regress-1";
        let session_id = store
            .create_session("assistant", "task", quest_id, None, Some(quest_id))
            .await
            .unwrap();

        let event = aeqi_core::ChatStreamEvent::ToolComplete {
            tool_use_id: "tu-1".into(),
            tool_name: "read_file".into(),
            success: true,
            input_preview: "/tmp/foo.txt".into(),
            output_preview: "hello".into(),
            duration_ms: 42,
        };
        persist_tool_complete(&store, &session_id, &event).await;

        let traces = store.tool_traces_for_quest(quest_id).await.unwrap();
        assert_eq!(
            traces.len(),
            1,
            "tool_traces_for_quest must surface the persisted tool_complete"
        );
        assert_eq!(traces[0].tool_name, "read_file");
    }

    #[tokio::test]
    async fn persist_tool_complete_ignores_non_toolcomplete_events() {
        let store = test_store().await;
        let quest_id = "as-regress-2";
        let session_id = store
            .create_session("assistant", "task", quest_id, None, Some(quest_id))
            .await
            .unwrap();

        let event = aeqi_core::ChatStreamEvent::TextDelta {
            text: "hello".into(),
        };
        persist_tool_complete(&store, &session_id, &event).await;

        let traces = store.tool_traces_for_quest(quest_id).await.unwrap();
        assert!(
            traces.is_empty(),
            "only ToolComplete events should be persisted as tool_complete rows"
        );
    }
}
