---
name: how-to-ask-the-director
tags: [skill, meta, agent]
description: When and how to fire question.ask to surface a decision to a human director.
---

# Skill: ask the director

`question.ask` is the async equivalent of stopping mid-sentence to ask a human. Fire it sparingly and only when you genuinely need a director's judgment to proceed.

## When to fire

- You're about to make a decision with material consequence (capital, irreversible action, scope change) and the right call needs human judgment.
- A user message arrived that you cannot answer without input you don't have, AND no human is currently in this chat.
- A long-running quest hits a fork that wasn't anticipated in its description.
- Scheduled / cron-fired execution: nobody's typing, but a decision is needed before you can continue.

## When NOT to fire

- A user is actively chatting with you. Just ask in plain text — they're already there.
- The question is rhetorical or recoverable from context. Make the call.
- You're stuck on a tactical detail (which library, which file). Don't escalate; figure it out.
- You already asked something on this thread. One outstanding ask at a time per session.

## How

```
question.ask({
  prompt: "<the FULL question — context + options + the ask, in one message>",
  subject: "<optional one-line preview ≤80 chars; defaults to a truncated prompt>"
})
```

**The `prompt` IS the question body — not a title.** It's the message the director reads. Include the context they need to decide in one read. The `subject` is only a short preview line for the inbox row; if you skip it the system truncates the prompt automatically. They are NOT a title-and-body pair where you put a title in `prompt` and continue the body in chat afterward.

After firing, **your turn ends.** Do not keep talking. Do not say "I'll wait for a response," "is there anything else I can help you with," or any other chat continuation — none of that reaches the director, and the chat user reads it as confused noise. The session disappears from active and reappears at `/` for the director. When they answer, you re-spawn with their reply as your next user message and pick up from there.

## Worked examples

**Bad — title-only prompt + chat continuation (this is wrong):**

```
question.ask({ prompt: "Should I deploy?" })
[then in chat:] "I've posted your question to the inbox. In the meantime, is there anything else?"
```

The director sees a one-liner with no context. The chat user reads redundant noise. Both are bad.

**Good — full question, no continuation:**

```
question.ask({
  prompt: "I'm ready to deploy v1.2 to staging. Diff is +312/-87, all tests green, no migration. Two options: (a) deploy now and monitor, (b) wait until tomorrow's standup. Which?",
  subject: "Deploy v1.2 to staging now or wait?"
})
```

[then nothing — turn ends]

## Discipline

- Be specific. "Should I do X?" beats "What do you think?"
- Give the director enough context to decide in one read. Reference the recent transcript when the answer requires it.
- If multiple options exist, list them. Don't ask open-ended questions in async.
- If you can recover by trying the safer option and reporting back, do that instead.
- Capability gate: this tool only works if your `can_ask_director` flag is on. If it's off, the call returns an error explaining why.
