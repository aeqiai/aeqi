# Product Contract

This document defines the product language AEQI should use everywhere that users or contributors can see it.

## Core Model

- `agent` = who
- `idea` = what the system should remember or inject
- `event` = when something should happen
- `quest` = what durable work needs to be done
- `session` = persistent runtime context
- `execution` = the live run inside a session
- `step` = the internal loop boundary inside an execution
- `input` = raw user text
- `context` = everything attached to that input

## Working Rules

- User messages start or resume an execution.
- Executions advance in steps, not in abstract chat turns.
- If an execution is already live, new input becomes pending context until the next safe step boundary.
- Queued inputs should coalesce before injection.
- Events can inject ideas.
- Files are just another source of ideas or context.

## UX Rules

- The active session must remain visibly active in the sidebar.
- The chat view must respect reader position and never yank the viewport away from deliberate upward scrolling.
- There should always be a fast jump-to-latest control near the composer.
- The product should feel snappy, direct, and honest about what is live versus pending.

## What This Is Not

- Not a plain chat wrapper.
- Not a one-off agent demo.
- Not a loose collection of prompts and attachments.
- Not chat-first terminology with agent features bolted on later.

## Product Goal

AEQI should feel like the face of a serious AI startup: a compact, legible, trustworthy runtime for agents, knowledge, and work.
