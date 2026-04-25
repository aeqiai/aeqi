---
name: meta:coding-examples
tags: [principle, example, meta]
description: Worked examples of the four behavior principles. Shows anti-pattern vs right approach for each. Cite-able from reflections when an agent catches itself drifting.
---

# Coding Examples

Seven anti-pattern → right-approach pairs, one per common drift. Cite when
you catch yourself doing the wrong column.

---

## 1. Hidden assumptions (Think first)

**Scenario:** User: "export this agent's ideas to a file."

**Wrong**

```rust
// Picks every field, JSON, all ideas, writes to cwd. Ships in one shot.
let ideas = ideas_store.list_for_agent(agent_id).await?;
std::fs::write("ideas.json", serde_json::to_string(&ideas)?)?;
```

Assumes scope (all ideas vs filtered), format (JSON vs CSV vs markdown),
location (cwd vs `/tmp` vs returned to caller), and which fields are
safe to leak (content_hash? source_ref?).

**Right**

> Before exporting, two things to confirm:
> 1. Scope — all ideas, or filter by tag (e.g. `evergreen`)?
> 2. Format — JSON for re-import, or markdown for human reading?
>
> Default I'd ship: tagged-only, markdown to stdout. OK?

**Why:** assumptions you don't surface become assumptions the user has to
catch in review. Cheaper to ask.

---

## 2. Multiple interpretations (Think first)

**Scenario:** User: "make idea search faster."

**Wrong**

```rust
// 200 lines: adds a HashMap cache, switches to FTS5, parallelizes the
// scorer, and pre-computes embeddings. Ships all four.
```

"Faster" wasn't defined. Latency? Throughput? Perceived speed? Each has
a different fix and a different cost.

**Right**

> "Faster" could mean three things:
> 1. Latency — query returns in <50ms (currently ~200ms). Add FTS index.
> 2. Throughput — handle 10x concurrent searches. Pool connections.
> 3. Perceived — show top result while the rest load. UI change.
>
> Which is biting? My guess is 1 from the symptom, but worth confirming.

**Why:** picking silently is faster for one turn and wrong half the time.

---

## 3. Over-abstraction (Minimum sufficient)

**Scenario:** User: "add a function that formats a tag list for display."

**Wrong**

```rust
trait TagFormatter { fn format(&self, tags: &[String]) -> String; }
struct CommaFormatter;
struct PipeFormatter;
struct BulletFormatter;
impl TagFormatter for CommaFormatter { /* ... */ }
// + factory + config + 60 lines of strategy pattern for one call site
```

**Right**

```rust
fn format_tags(tags: &[String]) -> String {
    tags.join(", ")
}
```

**Why:** you don't have multiple formatters. You have one. Strategy
patterns earn their slot when the second variant arrives, not before.

---

## 4. Speculative features (Minimum sufficient)

**Scenario:** User: "save the quest result to the DB."

**Wrong**

```rust
pub async fn save_quest_result(
    db: &Db, quest_id: &str, result: &Value,
    merge: bool, validate: bool, notify: bool, retries: u32,
    cache: Option<&Cache>, schema_version: u32,
) -> Result<bool> {
    // 80 lines handling every flag, plus a notify_subscribers stub
    // for an event system that doesn't exist yet.
}
```

**Right**

```rust
pub async fn save_quest_result(db: &Db, quest_id: &str, result: &Value) -> Result<()> {
    db.execute(
        "UPDATE quests SET result = ?1 WHERE id = ?2",
        rusqlite::params![result.to_string(), quest_id],
    )?;
    Ok(())
}
```

**Why:** retries, validation, notifications, caching — all real concerns,
none asked for. Add each when it has a caller, not in anticipation. The
flags-and-stubs version is harder to read, harder to test, and ships
bugs in code paths nobody uses.

---

## 5. Drive-by refactoring (Surgical scope)

**Scenario:** User: "fix the bug where empty agent names crash the
registry."

**Wrong diff**

```diff
- pub fn register(name: String, kind: AgentKind) -> Result<AgentId> {
-     if name.is_empty() {
+ pub fn register(name: impl Into<String>, kind: AgentKind) -> Result<AgentId> {
+     let name = name.into();
+     let name = name.trim().to_string();
+     if name.is_empty() {
          return Err(RegistryError::EmptyName);
      }
+     if name.len() > 64 {
+         return Err(RegistryError::NameTooLong);
+     }
+     if !name.chars().all(|c| c.is_alphanumeric() || c == '-') {
+         return Err(RegistryError::InvalidChars);
+     }
      // ... rest of function reformatted
  }
```

Fixed the empty case. Also changed the signature, added two unrelated
validators, and reformatted the body. Reviewer can't tell which line is
the bug fix.

**Right diff**

```diff
  pub fn register(name: String, kind: AgentKind) -> Result<AgentId> {
-     if name.is_empty() {
+     if name.trim().is_empty() {
          return Err(RegistryError::EmptyName);
      }
```

**Why:** the diff should match the bug. Length limits and char validation
are real concerns — file them as separate quests. Mixed-purpose diffs
erode trust in code review.

---

## 6. Reproduce before fixing (Define done)

**Scenario:** User: "the idea search returns duplicates when ideas share
a tag."

**Wrong**

```rust
// Goes straight to the fix without confirming the bug exists or
// understanding which join is multiplying rows.
let ideas: Vec<Idea> = ideas.into_iter()
    .collect::<HashSet<_>>()
    .into_iter()
    .collect();
```

Maybe fixes it. Maybe hides the real bug (a join cardinality issue) under
a dedupe. No way to know — there's no test.

**Right**

```rust
// 1. Test reproduces the duplication.
#[tokio::test]
async fn search_does_not_duplicate_when_idea_has_multiple_matching_tags() {
    let store = test_store().await;
    store.insert("idea-1", &["skill", "evergreen"]).await;

    let hits = store.search_by_tags(&["skill", "evergreen"]).await.unwrap();

    assert_eq!(hits.len(), 1, "expected one idea, got {}: {hits:?}", hits.len());
}

// 2. Run it. Fails — confirms the bug.
// 3. Fix the join (SELECT DISTINCT or GROUP BY idea_id), not a post-hoc dedupe.
// 4. Test passes. Existing tests still green.
```

**Why:** a test that fails before your fix and passes after is the only
proof the change does what you claim. Skipping that step ships fixes
that mask different bugs underneath.

---

## 7. Loading raw data when computation suffices (Minimum sufficient)

**Scenario:** User: "how many of our agents have an empty persona?"

**Wrong**

```rust
// Pulls every agent row + serializes into the assistant's context window
// so the assistant can eyeball the field across 800 entries.
let agents = agent_registry.list_all().await?;
let dump = serde_json::to_string_pretty(&agents)?;
println!("{dump}");
// Now spend 8000 tokens of context "reading" rows to answer "how many".
```

The minimum sufficient transfer is the **count**. Pulling rows so they
can be counted by an LLM is a compression failure — the answer is one
integer; the cost was megabytes.

**Right**

```sql
-- Compute, then return the answer.
SELECT COUNT(*) FROM agents WHERE persona_idea_id IS NULL;
```

Or one line of shell when the data lives in files:

```
rg -c '^persona_idea_id:\s*$' agents/*.toml | awk -F: '{s+=$2} END {print s}'
```

**Why:** an LLM context byte spent on raw data crowds out the byte where
the answer lives. The minimum sufficient input is the computed answer,
not the source it was computed from. When a question has a deterministic
answer, write the script that prints it — don't read the data and guess.

This applies to every "how many", "which ones", "where", "summarize"
question. The first instinct should be "what's the smallest computation
that turns this question into one fact?" not "how do I read enough to
answer this?".

---

## Summary

| Drift | Tell | Reset |
|---|---|---|
| Assumed scope/format/location | "I'll just pick…" | List the choices, ask |
| Picked one interpretation | "Faster" / "better" / "fix it" | Enumerate, confirm |
| Pattern for one call site | "In case we need…" | One function until two callers exist |
| Flags for unrequested features | "While I'm here…" | Cut every flag without a caller |
| Reformatted while fixing | "And I cleaned up…" | Diff matches the bug |
| Fixed without reproducing | "I think this is it…" | Failing test first, then fix |
| Read raw data to answer | "Let me load this and look…" | Compute the answer; transfer the result |

The pattern under all seven: complexity timing. The wrong column isn't
*wrong* code — it's code that arrived before its requirement.
