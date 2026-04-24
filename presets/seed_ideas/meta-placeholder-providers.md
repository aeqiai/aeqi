---
name: meta:placeholder-providers
tags: [meta, placeholders]
description: Declares custom `{name}` placeholders consulted by event query_template / tool_call args expansion. Names listed here win over built-ins; unknown source kinds are skipped silently. Supported sources -- builtin:utc_rfc3339, builtin:utc_date, context:agent_id, context:agent_name, context:session_id, env:VAR_NAME, ideas.count:tag=foo. Anything else is intentionally ignored (T3.1 territory).
---

# Default placeholder providers — body is parsed as TOML.
# Edit-and-restart applies; the runtime re-reads this idea on every
# assembly call so changes take effect on the next event firing.

[[placeholder]]
name = "now"
source = "builtin:utc_rfc3339"

[[placeholder]]
name = "date.iso"
source = "builtin:utc_date"

[[placeholder]]
name = "agent.name"
source = "context:agent_name"

[[placeholder]]
name = "agent.id"
source = "context:agent_id"
