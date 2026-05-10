# AEQI MCP — Claude Code Integration

Connect Claude Code to your AEQI company's agent. Five tools. No hooks. The agent's knowledge, work tracking, and code intelligence — available in every session.

## Setup

Add to your Claude Code `settings.json`:

```json
{
  "mcpServers": {
    "aeqi": {
      "command": "aeqi",
      "args": ["mcp"],
      "env": {
        "AEQI_AGENT": "my-agent"
      }
    }
  }
}
```

### Local development

Start the daemon, then use Claude Code:

```bash
aeqi daemon
```

No keys needed. Connects directly to `~/.aeqi/rm.sock`.

### Platform (remote runtime)

Remote chat and remote MCP use different credentials because they do different jobs.

For interactive chat, one account key is enough:

```bash
AEQI_API_KEY=ak_account_xxxxx aeqi chat
```

The account key identifies you. The chat session then selects:

- company/entity: where the session runs
- acting role: which human role context you are using, when applicable
- target agent: which agent receives the session

No extra key is required to choose the target agent.

MCP is different: it is an entity-scoped tool bridge for external clients, so it uses a company secret key and may also carry the account key to bind the call to your user account.

```json
{
  "mcpServers": {
    "aeqi": {
      "command": "aeqi",
      "args": ["mcp"],
      "env": {
        "AEQI_SECRET_KEY": "sk_company_xxxxx",
        "AEQI_API_KEY": "ak_account_xxxxx",
        "AEQI_AGENT": "my-agent"
      }
    }
  }
}
```

- `AEQI_SECRET_KEY` — identifies the company runtime for MCP
- `AEQI_API_KEY` — identifies the user account
- `AEQI_AGENT` — agent context for MCP tool operations, not the human account identity

### Optional: agent identity on session start

Add a single hook to inject the agent's identity into every session:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "AEQI_AGENT=my-agent aeqi scripts/session-primer.sh"
          }
        ]
      }
    ]
  }
}
```

This calls `agents(action='get')` and prints the agent's assembled ideas. One MCP call, 25 lines of bash. No opinions, no gates.

## Tools

| Tool | Actions | What it does |
|------|---------|-------------|
| `ideas` | store, search, update, delete | Persistent knowledge — facts, procedures, preferences, context |
| `quests` | create, list, show, update, close, cancel | Work tracking — hierarchical, with dependencies and outcomes |
| `agents` | get, hire, retire, list, projects, delegate | Agent management — hire children, delegate work, list projects |
| `events` | create, list, enable, disable, delete | Reaction rules — lifecycle triggers and scheduled automation |
| `code` | search, context, impact, file, stats, index | Code intelligence — symbol search, blast radius, dependency graph |

All operations are scoped to your agent. Ideas searches return your agent's knowledge + inherited knowledge from parent agents. Quests are owned by your agent. Events fire for your agent's lifecycle.

## How it works

The AEQI daemon is the runtime. It manages agents, ideas, quests, events, sessions, and code intelligence in two databases:

- **`aeqi.db`** — the company template (agents, events, ideas). Copy this file = clone the company.
- **`sessions.db`** — the runtime journal (sessions, quests, activity, runs). Delete this = fresh start.

The MCP server connects to the daemon via Unix socket IPC. Every tool call translates to a daemon command. The daemon handles concurrent connections — web UI, CLI, and MCP can all be connected simultaneously.

## Architecture

```
You (Claude Code) ──→ MCP (aeqi mcp) ──→ Daemon (rm.sock) ──→ aeqi.db + sessions.db
                                              ↑
Web UI ──→ HTTP API (aeqi-web) ──────────────┘
                                              ↑
CLI (aeqi chat) ──→ IPC ─────────────────────┘
```

One daemon. Many clients. Same agent state.

## Data model

Four primitives:

- **Agent** — persistent identity with parent-child tree. No static config — identity flows through events and ideas.
- **Idea** — knowledge unit. Facts, procedures, preferences, templates. Everything is an idea with tags.
- **Quest** — unit of work. Hierarchical IDs. Owns a git worktree for isolation. Tracks cost and outcome.
- **Event** — reaction rule. Fires on lifecycle signals or schedules. References ideas to activate.

No fifth primitive. No notes. No prompts. No triggers. No capabilities. Everything is one of the four.
