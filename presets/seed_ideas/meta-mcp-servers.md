---
name: meta:mcp-servers
tags: [meta, mcp, configuration]
description: Per-operator list of Model Context Protocol servers aeqi connects to at boot. The body is TOML; each [[server]] entry surfaces its tools as mcp:<server>:<tool> in the agent's tool registry.
---

# MCP servers.
#
# This idea body is parsed as TOML at daemon startup. The default config is
# intentionally empty, so a fresh install registers no MCP servers and emits no
# parse warnings. Uncomment and customize one or more [[server]] blocks to opt
# in. Tools register as mcp:<server-name>:<tool-name>.
#
# Schema:
#
# [[server]]
# name = "github-mcp"          # required; ascii alphanumeric plus - or _
# transport = "stdio"         # required; "stdio" or "sse"
#
# Stdio fields:
# command = "npx"
# args = ["@modelcontextprotocol/server-github"]
# env = { GITHUB_REPOSITORY = "owner/repo" }
#
# SSE fields:
# url = "https://mcp.example.com/sse"
# headers = { "x-api-key" = "..." }
#
# ACL: comma-separated subset of "Llm", "Event", "System". Defaults to "Llm".
# caller_kind = "Llm"
#
# Optional credential dependency.
# [server.requires_credential]
# provider = "github"
# lifecycle = "github_app"
# name = "oauth_token"
# scopes = ["repo:read"]
# env_var = "GITHUB_TOKEN"      # stdio env injection
# header = "Authorization"      # sse bearer injection
# arg = "--auth-token"          # stdio argv injection
#
# backoff_max_secs = 60
# enabled = true
#
# Worked examples:
#
# [[server]]
# name = "filesystem-local"
# transport = "stdio"
# command = "npx"
# args = ["@modelcontextprotocol/server-filesystem", "/home/me/projects"]
# caller_kind = "Llm"
#
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
#
# [[server]]
# name = "remote-mcp"
# transport = "sse"
# url = "https://mcp.example.com/sse"
# caller_kind = "Llm"
# [server.requires_credential]
# provider = "example_mcp"
# lifecycle = "oauth2"
# header = "Authorization"
