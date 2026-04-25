---
name: meta:mcp-servers
tags: [meta, mcp, configuration]
description: Per-operator list of Model Context Protocol servers aeqi connects to at boot. The body is TOML; each [[server]] entry surfaces its tools as mcp:<server>:<tool> in the agent's tool registry.
---

# MCP servers

Operator-edited TOML body — one `[[server]]` block per MCP server aeqi
should connect to on startup. Tools exposed by each server appear in the
agent's tool registry as `mcp:<server-name>:<tool-name>`.

The default body is empty: no MCP servers connect, no MCP tools register,
zero overhead. Add servers below to opt in.

## Schema

```toml
[[server]]
# Required.
name = "github-mcp"            # used as the namespace prefix; lowercase + - + _
transport = "stdio"            # "stdio" | "sse"

# stdio fields (required when transport == "stdio").
command = "npx"
args = ["@modelcontextprotocol/server-github"]
env = { GITHUB_REPOSITORY = "owner/repo" }   # passed to the subprocess

# sse fields (required when transport == "sse").
url = "https://mcp.example.com/sse"
headers = { "x-api-key" = "..." }            # any extra static headers

# ACL — comma-separated subset of "Llm", "Event", "System". Defaults to
# "Llm" only (security boundary: never let MCP tools fire as System
# unless the operator explicitly opts in).
caller_kind = "Llm"

# Optional credential dependency. Resolved via T1.9's substrate before
# spawn; resolved bearer / blob is injected per the inject-mode field.
[server.requires_credential]
provider = "github"            # matches the credentials row's `provider`
lifecycle = "github_app"       # documentation only — substrate uses lifecycle_kind
name = "oauth_token"           # credentials row name; defaults to "oauth_token"
scopes = ["repo:read"]         # OAuth scopes, validated by the substrate

# Pick exactly one inject mode. Multiple are honoured env > header > arg.
env_var = "GITHUB_TOKEN"        # stdio: passed as env var
# header = "Authorization"      # sse: prepended `Bearer <token>`
# arg = "--auth-token"          # stdio: appended `<arg> <bearer>` to args

# Reconnect tuning (defaults shown).
backoff_max_secs = 60
enabled = true
```

## Worked examples (commented out — uncomment + customise to enable)

```toml
# Anthropic reference: filesystem MCP server, scoped to a single dir.
# [[server]]
# name = "filesystem-local"
# transport = "stdio"
# command = "npx"
# args = ["@modelcontextprotocol/server-filesystem", "/home/me/projects"]
# caller_kind = "Llm"

# Anthropic reference: GitHub MCP server using a stored GitHub App
# credential.
# [[server]]
# name = "github"
# transport = "stdio"
# command = "npx"
# args = ["@modelcontextprotocol/server-github"]
# caller_kind = "Llm"
# [server.requires_credential]
# provider = "github"
# lifecycle = "github_app"
# name = "installation_token"
# env_var = "GITHUB_TOKEN"

# Hosted MCP server speaking SSE, authed via OAuth2.
# [[server]]
# name = "remote-mcp"
# transport = "sse"
# url = "https://mcp.example.com/sse"
# caller_kind = "Llm"
# [server.requires_credential]
# provider = "example_mcp"
# lifecycle = "oauth2"
# header = "Authorization"      # injected as `Bearer <access_token>`
```

## Notes

- Tools are registered under `mcp:<name>:<tool>` to prevent collisions
  with native aeqi tools and across different servers.
- A server that crashes mid-session is reconnected with exponential
  backoff (`backoff_max_secs` cap). While disconnected, every call to a
  tool from that server returns the stable `unavailable` reason code so
  agents can reason about the failure.
- Setting `enabled = false` keeps the entry in the file but skips
  connection — useful for quick toggles during debugging.
- Operators can run `aeqi doctor` to see which MCP servers are connected
  vs unavailable, with the same reason-code surface used by the
  credentials substrate.
