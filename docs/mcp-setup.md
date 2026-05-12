# AEQI MCP — Client-Agnostic Integration

Connect any MCP-capable client to your aeqi company runtime. The contract is
client-agnostic: Codex, Claude Code, editors, downstream SaaS agents, and local
self-hosted tools all authenticate as the API-key owner and receive the same
actor-aware tool surface.

## Setup

For local stdio clients, add an `aeqi` MCP server that runs `aeqi mcp`:

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

Start the daemon, then start your MCP client:

```bash
aeqi daemon
```

No platform keys are needed for a purely local self-hosted runtime. The stdio
server connects directly to the runtime's `rm.sock` and acts as the local
operator.

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

MCP is different: it is an entity-scoped tool bridge for external clients, so it
uses a company secret key and may also carry the account key to bind the call to
your user account. Wrappers for Codex or Claude Code are convenience shims only;
authorization is not client-specific.

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

### Hosted HTTP MCP

Hosted SaaS clients that support HTTP JSON-RPC can call the platform-hosted MCP
endpoint directly:

```http
POST https://app.aeqi.ai/api/mcp
Authorization: Bearer sk_company_xxxxx
X-Api-Key: ak_account_xxxxx
Content-Type: application/json

{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}
```

The platform validates the secret key, resolves the runtime placement, injects
the actor scope, and forwards the same JSON-RPC request to the tenant runtime.

### Self-Hosted HTTP MCP

Self-hosted runtimes expose their own runtime MCP endpoint:

```http
POST http://localhost:8400/api/mcp
Authorization: Bearer <runtime session token>
Content-Type: application/json

{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
```

In platform-managed runtimes, internal calls use the signed platform scope
headers instead of a user JWT. Direct public callers should go through the
platform endpoint unless they own the runtime deployment and its auth boundary.

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
| `me` | profile, permissions | Authenticated actor, runtime transport, and entity scope |
| `ideas` | store, search, update, delete, link, feedback, walk | Persistent knowledge — facts, procedures, preferences, context |
| `quests` | create, list, show, update, close, cancel | Work tracking — hierarchical, with dependencies and outcomes |
| `agents` | get, hire, retire, list, projects, delegate | Agent management — hire children, delegate work, list projects |
| `events` | create, list, enable, disable, delete | Reaction rules — lifecycle triggers and scheduled automation |
| `code` | search, context, impact, file, stats, index | Code intelligence — symbol search, blast radius, dependency graph |

All operations are scoped to your agent. Ideas searches return your agent's knowledge + inherited knowledge from parent agents. Quests are owned by your agent. Events fire for your agent's lifecycle.

## How it works

The AEQI daemon is the runtime. It manages agents, ideas, quests, events, sessions, and code intelligence in two databases:

- **`aeqi.db`** — the company template (agents, events, ideas). Copy this file = clone the company.
- **`sessions.db`** — the runtime journal (sessions, quests, activity, runs). Delete this = fresh start.

The stdio MCP server connects to the daemon via Unix socket IPC. The HTTP MCP
endpoint lives in `aeqi-web` and forwards tool calls to the same daemon IPC with
the same actor envelope. Every tool call translates to a daemon command. The
daemon handles concurrent connections — web UI, CLI, HTTP MCP, and stdio MCP can
all be connected simultaneously.

## Architecture

```
MCP client ──→ Platform /api/mcp ──→ Runtime /api/mcp ──→ Daemon (rm.sock)
                      │                    ↑                    │
Local client ──→ aeqi mcp ─────────────────┘                    ↓
Web UI ──→ HTTP API (aeqi-web) ─────────────────────────→ aeqi.db + sessions.db
CLI (aeqi chat) ──→ IPC ─────────────────────────────────────────┘
```

One daemon. Many clients. Same agent state.

## Data model

Four primitives:

- **Agent** — persistent identity with parent-child tree. No static config — identity flows through events and ideas.
- **Idea** — knowledge unit. Facts, procedures, preferences, templates. Everything is an idea with tags.
- **Quest** — unit of work. Hierarchical IDs. Owns a git worktree for isolation. Tracks cost and outcome.
- **Event** — reaction rule. Fires on lifecycle signals or schedules. References ideas to activate.

No fifth primitive. No notes. No prompts. No triggers. No capabilities. Everything is one of the four.
