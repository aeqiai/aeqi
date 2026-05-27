# aeqi MCP — Client-Agnostic Integration

Connect any MCP-capable client to your aeqi TRUST runtime. The same `aeqi`
binary supports two deployment shapes:

- hosted TRUST: `aeqi mcp` is a local stdio bridge into the managed
  runtime selected by your platform credentials.
- self-hosted runtime: `aeqi mcp` connects to the daemon you run yourself.

The contract is client-agnostic: Codex, Claude Code, editors, downstream SaaS
agents, and local self-hosted tools all receive the same actor-aware tool
surface.

## Setup

For local stdio clients, add an `aeqi` MCP server that runs `aeqi mcp`. For a
hosted TRUST, provide both the TRUST secret and account key:

```json
{
  "mcpServers": {
    "aeqi": {
      "command": "aeqi",
      "args": ["mcp"],
      "env": {
        "AEQI_SECRET_KEY": "sk_trust_xxxxx",
        "AEQI_API_KEY": "ak_account_xxxxx",
        "AEQI_API_URL": "https://app.aeqi.ai",
        "AEQI_AGENT": "codex"
      }
    }
  }
}
```

For a self-hosted daemon on the same machine, omit the platform credentials and
let `aeqi mcp` connect to the local runtime socket.

### Local development

Start the daemon, then start your MCP client:

```bash
aeqi start
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

- TRUST: where the session runs
- acting role: which human role context you are using, when applicable
- target agent: which agent receives the session

No extra key is required to choose the target agent.

MCP is different: it is a TRUST-scoped tool bridge for external clients. It
uses a TRUST secret key to select the runtime and should also carry the account
key to bind the call to your user account. Wrappers for Codex or
Claude Code are convenience shims only; authorization is not client-specific.

```json
{
  "mcpServers": {
    "aeqi": {
      "command": "aeqi",
      "args": ["mcp"],
      "env": {
        "AEQI_SECRET_KEY": "sk_trust_xxxxx",
        "AEQI_API_KEY": "ak_account_xxxxx",
        "AEQI_API_URL": "https://app.aeqi.ai",
        "AEQI_AGENT": "codex"
      }
    }
  }
}
```

- `AEQI_SECRET_KEY` — identifies the TRUST runtime for hosted MCP
- `AEQI_API_KEY` — identifies the user account
- `AEQI_API_URL` — platform API base URL; defaults to the production platform when omitted
- `AEQI_AGENT` — client/agent hint for logs/context, not the human account identity. It does not automatically own new quests, filter quest lists, or scope idea memory.
- `AEQI_AGENT_ID` — optional explicit agent scope. The shared wrapper does not set this from the runtime default; pass `agent_id` only when intentionally working inside a specific runtime agent's memory.

### Common user stories

Work as yourself from Codex or Claude Code:

1. Configure the MCP server with `AEQI_SECRET_KEY` and `AEQI_API_KEY`.
2. Use `me(action="profile")` to confirm the actor and TRUST scope.
3. Use `ideas`, `quests`, `events`, `code`, and `browser` as your TRUST memory,
   work ledger, automation, code, and browser-capability surfaces.

`browser` is currently a read-only contract surface. Call
`browser(action="capabilities")` to inspect backend order and required audit
controls. Mutable browser actions are intentionally disabled until AEQI wires a
quest-scoped session runner and artifact store.

Delegate to an existing runtime agent:

1. Use `agents(action="list")` to find the existing agent.
2. Use `quests(action="create", agent="agent-name", ...)` to assign work.
3. Use `quests(action="show", ...)` or `agents(action="get", ...)` to inspect outcome and context.

Create a new persistent agent:

1. Use `agents(action="hire", template="analyst")` or another available template.
2. Store durable instructions with `ideas(action="store", agent_id="...", ...)`.
3. Create quests assigned to that agent when it should own work.

The CLI is still only the client in hosted mode. Hiring an agent changes the
hosted TRUST runtime state; it does not spawn a local daemon on your machine.

### Hosted HTTP MCP

Hosted SaaS clients that support HTTP JSON-RPC can call the platform-hosted MCP
endpoint directly:

```http
POST https://<host>/api/mcp
Authorization: Bearer sk_trust_xxxxx
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
            "command": "AEQI_AGENT=my-agent aeqi primer"
          }
        ]
      }
    ]
  }
}
```

This calls `agents(action='get')` and prints the agent's assembled ideas. One MCP call, 25 lines of bash. No opinions, no gates.

## Tools

| Tool     | Actions                                             | What it does                                                     |
| -------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| `me`     | profile, permissions                                | Authenticated actor, runtime transport, and TRUST scope          |
| `ideas`  | store, search, update, delete, link, feedback, walk | Persistent knowledge: facts, procedures, preferences, context    |
| `quests` | create, list, show, update, close, cancel           | Work tracking: hierarchy, dependencies, assignment, outcomes     |
| `agents` | get, hire, retire, list, projects                   | Agent management: inspect, hire, retire, list projects           |
| `events` | create, list, enable, disable, delete               | Reaction rules: lifecycle triggers and scheduled automation      |
| `code`   | search, context, impact, file, stats, index         | Code intelligence: symbol search, blast radius, dependency graph |

Tool scope follows the authenticated actor and selected TRUST. In hosted mode,
that is normally your user account inside the TRUST selected by the secret key.
Use explicit `agent` or `agent_id` parameters when you want a runtime agent to
own the work.

## How it works

For self-hosting, the aeqi daemon is the runtime. It manages agents, ideas,
quests, events, sessions, and code intelligence in two databases:

- **`aeqi.db`** — the TRUST template (agents, events, ideas). Copy this file = clone the TRUST.
- **`sessions.db`** — the runtime journal (sessions, quests, activity, runs). Delete this = fresh start.

The stdio MCP server connects to the daemon via Unix socket IPC. In hosted mode,
the local stdio process connects to the platform, which resolves the TRUST
runtime and forwards the same MCP JSON-RPC calls to that runtime. The HTTP MCP
endpoint lives in `aeqi-web` and forwards tool calls to the same daemon IPC with
the same actor envelope. Every tool call translates to a daemon command. The
daemon handles concurrent connections: web UI, CLI, HTTP MCP, and stdio MCP can
all be connected simultaneously.

## Architecture

```
MCP client ──→ Platform /api/mcp ──→ Runtime /api/mcp ──→ Daemon (rm.sock)
                      │                    ↑                    │
Local client ──→ aeqi mcp ─────────────────┘                    ↓
Web UI ──→ HTTP API (aeqi-web) ─────────────────────────→ aeqi.db + sessions.db
CLI (aeqi chat) ──→ IPC ─────────────────────────────────────────┘
```

One runtime. Many clients. Same agent state.

## Data model

MCP exposes the same surfaces defined in
[primitive-contract.md](primitive-contract.md): a TRUST is the shared AI
workspace and runtime for one mission; roles, agents, quests, ideas, events,
sessions, and apps/tools are the surfaces inside it.

- **Role** — authority, responsibility, scope, permissions, budgets, and occupancy.
- **Agent** — persistent identity with parent-child tree. Identity and behavior flow through roles, events, and ideas.
- **Quest** — unit of work. Hierarchical IDs. Owns a git worktree for isolation. Tracks evidence, cost, and outcome.
- **Idea** — knowledge unit. Facts, procedures, preferences, directives, templates, and durable memory.
- **Event** — reaction rule. Fires on lifecycle signals, schedules, webhooks, or patterns and runs tool calls.
- **Session** — persistent execution and conversation trace.
- **App / Tool** — capability the TRUST can connect, install, call, or authorize.

Legacy MCP clients may still talk mostly in agents, ideas, quests, and events;
new docs and tools should preserve those APIs while presenting the broader
TRUST operating contract.
