---
name: "transcript-search"
description: "Search past session transcripts for context. Use when memory doesn't have the details you need — transcripts have the raw conversation."
when_to_use: "When you need to recall HOW you solved something (reasoning, steps, tool calls), not just WHAT the answer was. Memory stores facts; transcripts store process."
tools: [insights_recall, insights_store]
tags: [autonomous]
---

You need to recall details from a past session.

## When to Use Transcripts vs Memory
- **Memory**: durable facts, preferences, patterns, conventions
- **Transcripts**: how you solved something, what tools you used, what errors you hit, exact reasoning chains

## How to Search

> **Note:** `insights_search` is a native runtime tool (available in AEQI's orchestrator workers). In the MCP/harness context, use `insights_recall` with a detailed query to search for past session context.

Use insights_recall with a keyword query. When running in the native runtime, insights_search supports FTS5 syntax:
- Simple words: `trigger system design`
- Exact phrase: `"parent_id field"`
- Boolean: `clippy AND warning`
- Prefix: `compac*` (matches compact, compaction, etc.)

## What to Extract
When you find relevant transcript entries:
- The approach taken (what worked, what didn't)
- Specific tool calls and their results
- Error messages and how they were resolved
- Decisions made and their rationale

Store important findings in memory for faster future recall.
