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

/// Build the `bug-fix` preset for a given subject and symptom.
///
/// Six phases tuned for root-cause fixes (not patches):
///
/// 1. Reproduce — make the bug visible on demand
/// 2. Isolate   — narrow the failure to a single responsible component
/// 3. Root cause — explain *why*, not just *where*
/// 4. Fix      — minimal change that addresses the root cause
/// 5. Regress  — add a test that fails before the fix and passes after
/// 6. Summary  — handoff note: root cause, fix, and any related code smells
pub fn bug_fix_preset(subject: &str, symptom: &str) -> QuestPreset {
    let description = format!(
        "## Bug Fix: {subject}

**Reported symptom:** {symptom}

Work through the following phases in order. Bias toward root-cause fixes \
over patches; a bug that hides still exists.

### Phase 1 — Reproduce
Reproduce the reported symptom on demand. Capture the exact failing input, \
command, or click path. If you cannot reproduce, stop and report what you \
tried — the bug may be environment-dependent.

### Phase 2 — Isolate
Narrow the failure to the smallest responsible component. Bisect if needed \
(git bisect, binary-search the input, disable half the code). The goal is a \
single file + function where the wrong thing first happens.

### Phase 3 — Root cause
Explain in 1-2 sentences *why* the bug exists, not just *where*. A good root \
cause reveals a broken assumption, not just a faulty line.

### Phase 4 — Fix
Make the minimal change that addresses the root cause. Avoid speculative \
cleanup in the same commit. If the root cause implies other latent bugs \
elsewhere, file follow-up quests.

### Phase 5 — Regress
Add a test that fails against the unfixed code and passes against the fix. \
No test = no regression guarantee = not really fixed. Run the full test \
suite and lints.

### Phase 6 — Summary
Handoff note: root cause, the fix, any related code smells you spotted but \
did not address, and whether a backport is needed."
    );

    let acceptance_criteria = format!(
        "- Symptom is reproducible via a documented step
- Root cause is identified in the summary (not just the fix site)
- A regression test exists that fails pre-fix and passes post-fix
- Zero clippy warnings (`cargo clippy --workspace -- -D warnings`)
- All workspace tests pass (`cargo test --workspace`)
- Phase 6 summary note is present in the quest outcome for: {subject}"
    );

    QuestPreset {
        subject: format!("bug-fix: {subject}"),
        description,
        acceptance_criteria,
        labels: vec!["bug-fix".to_string(), "preset".to_string()],
    }
}

/// Build the `refactor` preset for a given subject and motivation.
///
/// Five phases tuned for behaviour-preserving changes:
///
/// 1. Baseline   — capture current behaviour as tests
/// 2. Plan       — identify the end shape and the safe-path from here to there
/// 3. Transform  — small commits, tests green at every step
/// 4. Verify     — full suite, plus any manual flows the tests don't cover
/// 5. Summary    — what moved, what the motivation resolved, what was left
pub fn refactor_preset(subject: &str, motivation: &str) -> QuestPreset {
    let description = format!(
        "## Refactor: {subject}

**Motivation:** {motivation}

A refactor is a behaviour-preserving change. If behaviour changes, split \
that into a separate feature or bug-fix quest.

### Phase 1 — Baseline
Confirm there are tests covering the surface you intend to move. If coverage \
is thin, add characterization tests *first* — the tests are the safety net \
for the refactor itself.

### Phase 2 — Plan
Describe the end shape in 3-5 bullets: what lives where, what the new public \
API looks like, which types move. Identify the smallest sequence of steps \
that keeps tests green throughout. Stop here if you cannot find one.

### Phase 3 — Transform
Execute the plan in small commits (or checkpoints). Run tests after each \
step. If a step breaks tests, revert and split it smaller. Resist bundling \
unrelated cleanups.

### Phase 4 — Verify
Run the full test suite and lints. Exercise any flows the tests don't cover \
(UI smoke, integration endpoints). Confirm public API changes are reflected \
in callers.

### Phase 5 — Summary
Handoff note: what moved, how the motivation is resolved, any code that \
would have fit the new shape but was left untouched on purpose, and any \
follow-up quests."
    );

    let acceptance_criteria = format!(
        "- All tests that passed before the refactor still pass — no behaviour change
- Zero clippy warnings (`cargo clippy --workspace -- -D warnings`)
- The motivation is addressed: {motivation}
- Public API changes (if any) are reflected in all callers
- Phase 5 summary note is present in the quest outcome for: {subject}"
    );

    QuestPreset {
        subject: format!("refactor: {subject}"),
        description,
        acceptance_criteria,
        labels: vec!["refactor".to_string(), "preset".to_string()],
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

    #[test]
    fn bug_fix_preset_has_six_phase_headers() {
        let preset = bug_fix_preset(
            "null pointer on login",
            "500 on /auth/me when token missing",
        );
        let phase_count = preset
            .description
            .lines()
            .filter(|line| line.starts_with("### Phase "))
            .count();
        assert_eq!(phase_count, 6, "expected 6 phase headers");
    }

    #[test]
    fn bug_fix_preset_embeds_subject_and_symptom() {
        let preset = bug_fix_preset("login NPE", "users see 500 on refresh");
        assert!(preset.description.contains("login NPE"));
        assert!(preset.description.contains("users see 500 on refresh"));
        for phase in &["Reproduce", "Isolate", "Root cause", "Fix", "Regress"] {
            assert!(preset.description.contains(phase), "missing phase {phase}");
        }
        assert_eq!(preset.subject, "bug-fix: login NPE");
        assert!(preset.labels.contains(&"bug-fix".to_string()));
    }

    #[test]
    fn refactor_preset_has_five_phase_headers() {
        let preset = refactor_preset("extract auth middleware", "reduce duplication in handlers");
        let phase_count = preset
            .description
            .lines()
            .filter(|line| line.starts_with("### Phase "))
            .count();
        assert_eq!(phase_count, 5, "expected 5 phase headers");
    }

    #[test]
    fn refactor_preset_embeds_subject_and_motivation() {
        let preset = refactor_preset("extract auth middleware", "cut handler duplication");
        assert!(preset.description.contains("extract auth middleware"));
        assert!(preset.description.contains("cut handler duplication"));
        for phase in &["Baseline", "Plan", "Transform", "Verify", "Summary"] {
            assert!(preset.description.contains(phase), "missing phase {phase}");
        }
        assert_eq!(preset.subject, "refactor: extract auth middleware");
        assert!(preset.labels.contains(&"refactor".to_string()));
    }
}
