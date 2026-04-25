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
  prompt: "Should I proceed with X, given the trade-off Y?",
  subject: "Optional one-line label, ≤80 chars"
})
```

The `subject` becomes the inbox row preview. The `prompt` becomes your last message in the session. After firing, your turn ends; the session reappears for the director at `/`. When they answer, you re-spawn with their reply as the next user message.

## Discipline

- Be specific. "Should I do X?" beats "What do you think?"
- Give the director enough context to decide in one read. Reference the recent transcript when the answer requires it.
- If multiple options exist, list them. Don't ask open-ended questions in async.
- If you can recover by trying the safer option and reporting back, do that instead.
- Capability gate: this tool only works if your `can_ask_director` flag is on. If it's off, the call returns an error explaining why.
