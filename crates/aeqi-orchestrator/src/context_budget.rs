//! Context Budget — Controls token usage per worker by truncating and
//! summarizing context layers that exceed configurable limits.

use tracing::debug;

/// Budget limits for each context layer (char-based, ~4 chars/token).
pub struct ContextBudget {
    pub max_shared_workflow: usize,
    pub max_persona: usize,
    pub max_evolution: usize,
    pub max_agents: usize,
    pub max_knowledge: usize,
    pub max_preferences: usize,
    pub max_memory: usize,
    pub max_checkpoints: usize,
    pub max_checkpoint_count: usize,
    pub max_total: usize,
}

impl Default for ContextBudget {
    fn default() -> Self {
        Self {
            max_shared_workflow: 2000,
            max_persona: 4000,
            max_evolution: 2000,
            max_agents: 8000,
            max_knowledge: 12000,
            max_preferences: 4000,
            max_memory: 8000,
            max_checkpoints: 8000,
            max_checkpoint_count: 5,
            max_total: 120000,
        }
    }
}

impl ContextBudget {
    /// Create from aeqi.toml config.
    pub fn from_config(cfg: &aeqi_core::ContextBudgetConfig) -> Self {
        Self {
            max_shared_workflow: cfg.max_shared_workflow,
            max_persona: cfg.max_persona,
            max_evolution: 2000,
            max_agents: cfg.max_agents,
            max_knowledge: cfg.max_knowledge,
            max_preferences: cfg.max_preferences,
            max_memory: cfg.max_memory,
            max_checkpoints: cfg.max_checkpoints,
            max_checkpoint_count: cfg.max_checkpoint_count,
            max_total: cfg.max_total,
        }
    }

    /// Truncate text to fit within char budget.
    pub fn truncate(text: &str, max_chars: usize) -> String {
        if text.len() <= max_chars {
            return text.to_string();
        }
        let safe_end = max_chars.saturating_sub(40);
        let cut = text[..safe_end].rfind('\n').unwrap_or(safe_end);
        format!(
            "{}\n\n[... truncated, {} chars omitted]",
            &text[..cut],
            text.len() - cut
        )
    }

    /// Summarize old checkpoints, keep recent ones verbatim.
    pub fn budget_checkpoints(&self, checkpoints: &[aeqi_quests::Checkpoint]) -> String {
        if checkpoints.is_empty() {
            return String::new();
        }

        let mut out = String::from("## Previous Attempts\n\n");

        if checkpoints.len() <= self.max_checkpoint_count {
            for (i, cp) in checkpoints.iter().enumerate() {
                out.push_str(&format!(
                    "### Attempt {} (by {}, {} steps, ${:.4})\n{}\n\n",
                    i + 1,
                    cp.agent_name,
                    cp.steps_used,
                    cp.cost_usd,
                    cp.progress
                ));
            }
        } else {
            let split = checkpoints.len() - self.max_checkpoint_count;
            out.push_str(&format!("*{split} earlier attempts summarized:*\n"));
            for cp in &checkpoints[..split] {
                let first_line = cp.progress.lines().next().unwrap_or("(no summary)");
                let line = if first_line.len() > 120 {
                    &first_line[..120]
                } else {
                    first_line
                };
                out.push_str(&format!(
                    "- {} ({} steps, ${:.4}): {}\n",
                    cp.agent_name, cp.steps_used, cp.cost_usd, line
                ));
            }
            out.push('\n');

            for (i, cp) in checkpoints[split..].iter().enumerate() {
                out.push_str(&format!(
                    "### Attempt {} (by {}, {} steps, ${:.4})\n{}\n\n",
                    split + i + 1,
                    cp.agent_name,
                    cp.steps_used,
                    cp.cost_usd,
                    cp.progress
                ));
            }
        }

        Self::truncate(&out, self.max_checkpoints)
    }

    /// Apply budget to a full system prompt string (total truncation only).
    pub fn apply_to_system_prompt(&self, prompt: &str) -> String {
        if prompt.len() > self.max_total {
            debug!(
                total = prompt.len(),
                budget = self.max_total,
                "context exceeds budget, truncating"
            );
            Self::truncate(prompt, self.max_total)
        } else {
            prompt.to_string()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_truncate_short() {
        assert_eq!(ContextBudget::truncate("hello", 100), "hello");
    }

    #[test]
    fn test_truncate_long() {
        let text = "line one\nline two\nline three\nline four\nline five";
        let result = ContextBudget::truncate(text, 30);
        assert!(result.contains("truncated"));
    }

    #[test]
    fn test_budget_checkpoints_few() {
        let budget = ContextBudget::default();
        let cps = vec![aeqi_quests::Checkpoint {
            timestamp: chrono::Utc::now(),
            agent_name: "s1".into(),
            progress: "did thing 1".into(),
            cost_usd: 0.05,
            steps_used: 3,
        }];
        let result = budget.budget_checkpoints(&cps);
        assert!(result.contains("did thing 1"));
    }

    #[test]
    fn test_budget_checkpoints_many() {
        let budget = ContextBudget {
            max_checkpoint_count: 2,
            ..Default::default()
        };
        let cps: Vec<_> = (0..10)
            .map(|i| aeqi_quests::Checkpoint {
                timestamp: chrono::Utc::now(),
                agent_name: format!("s{i}"),
                progress: format!("progress for attempt {i}"),
                cost_usd: 0.01 * i as f64,
                steps_used: i as u32,
            })
            .collect();
        let result = budget.budget_checkpoints(&cps);
        assert!(result.contains("8 earlier attempts summarized"));
    }
}
