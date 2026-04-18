//! Named quest templates that pre-fill description and acceptance criteria.
//!
//! A `QuestPreset` carries everything needed to call `create_quest` — the
//! caller only needs to supply a `subject` and a `project`.  No phase-runner
//! logic lives here; the agent reads the phases from the description and drives
//! them itself.

/// A pre-filled quest template ready to be submitted to the quest store.
#[derive(Debug, Clone)]
pub struct QuestPreset {
    /// Human-readable subject / name of the quest.
    pub subject: String,
    /// Multi-phase description the agent follows step-by-step.
    pub description: String,
    /// Explicit acceptance criteria the agent validates before closing.
    pub acceptance_criteria: String,
    /// Suggested labels to attach.
    pub labels: Vec<String>,
}

/// Build the `feature-dev` preset for a given subject.
///
/// The description enumerates all 7 phases so the agent can proceed
/// phase-by-phase without a separate phase-runner:
///
/// 1. Discovery — clarify requirements
/// 2. Explore   — survey existing code
/// 3. Design    — settle on approach
/// 4. Gate      — confirm design before writing code
/// 5. Implement — write the code
/// 6. Review    — verify quality & tests
/// 7. Summary   — produce handoff notes
pub fn feature_dev_preset(subject: &str) -> QuestPreset {
    let description = format!(
        "## Feature Development: {subject}

Work through the following phases in order. Complete each phase fully before \
proceeding to the next. Do not skip phases.

### Phase 1 — Discovery
Clarify the requirement. Identify the user goal, any ambiguities, and relevant \
constraints. If anything is unclear, surface it before continuing.

### Phase 2 — Explore
Survey the existing codebase. Identify all files, modules, and patterns that \
will be touched or extended. Note any similar prior implementations to reuse.

### Phase 3 — Design
Settle on a concrete implementation approach. Define the public API / data \
structures / entry points. Keep the design minimal and consistent with existing \
conventions.

### Phase 4 — Gate
Summarise the design in 3-5 bullet points and confirm it satisfies the \
requirement before writing any code. Stop here if blockers are found.

### Phase 5 — Implement
Write the code. Follow project style (zero clippy warnings, zero unused \
variables, no dead code). All new public items must have doc-comments.

### Phase 6 — Review
Run the full test suite and lints. Fix every failure. Write or extend unit \
tests to cover the new behaviour. Confirm acceptance criteria are met.

### Phase 7 — Summary
Produce a concise handoff note: what was built, the entry point (file + \
function), demo command or curl, and any follow-up work deferred."
    );

    let acceptance_criteria = format!(
        "- All 7 phases completed in order for: {subject}
- Zero clippy warnings (`cargo clippy --workspace -- -D warnings`)
- All workspace tests pass (`cargo test --workspace`)
- New behaviour is covered by at least one unit test
- Phase 7 summary note is present in the quest outcome"
    );

    QuestPreset {
        subject: format!("feature-dev: {subject}"),
        description,
        acceptance_criteria,
        labels: vec!["feature-dev".to_string(), "preset".to_string()],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn feature_dev_preset_has_seven_phase_headers() {
        let preset = feature_dev_preset("add widget API");
        let phase_count = preset
            .description
            .lines()
            .filter(|line| line.starts_with("### Phase "))
            .count();
        assert_eq!(
            phase_count, 7,
            "expected 7 phase headers, got {phase_count}"
        );
    }

    #[test]
    fn feature_dev_preset_content_stability() {
        let preset = feature_dev_preset("test subject");

        // Subject is embedded in the description and acceptance criteria.
        assert!(
            preset.description.contains("test subject"),
            "description must contain the subject"
        );
        assert!(
            preset.acceptance_criteria.contains("test subject"),
            "acceptance_criteria must contain the subject"
        );

        // All 7 canonical phase names are present.
        for phase in &[
            "Discovery",
            "Explore",
            "Design",
            "Gate",
            "Implement",
            "Review",
            "Summary",
        ] {
            assert!(
                preset.description.contains(phase),
                "description missing phase: {phase}"
            );
        }

        // Labels are set.
        assert!(preset.labels.contains(&"feature-dev".to_string()));
        assert!(preset.labels.contains(&"preset".to_string()));

        // Subject field is prefixed correctly.
        assert_eq!(preset.subject, "feature-dev: test subject");
    }
}
