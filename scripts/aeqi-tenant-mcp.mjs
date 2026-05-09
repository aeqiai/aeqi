#!/usr/bin/env node
/**
 * aeqi-tenant-mcp.mjs — MCP stdio bridge to the AEQI tenant's HTTP API.
 *
 * The canonical `aeqi mcp` CLI binary connects via Unix socket to the
 * tenant's `rm.sock`. AEQI's socket is owned by `aeqi-t01:aeqi-t60001`
 * (sandbox isolation), so claudedev cannot open it directly. AEQI
 * runtime instead exposes its HTTP API at 127.0.0.1:8401 with
 * auth=none (sandbox-internal). This bridge proxies MCP JSON-RPC 2.0
 * over stdio to that HTTP API.
 *
 * Tools surfaced (subset of canonical aeqi MCP):
 *   - ideas (action: store|search|update|delete|link|list|get)
 *
 * Tenant scoping is implicit: AEQI's runtime only sees AEQI data.
 * No X-Entity header required.
 *
 * Env:
 *   AEQI_RUNTIME_URL — base URL (default: http://127.0.0.1:8401)
 *
 * Wired from ~/.claude/settings.json mcpServers["aeqi-tenant"].
 */

import readline from "node:readline";
import { stderr, stdin, stdout } from "node:process";

const RUNTIME_URL = process.env.AEQI_RUNTIME_URL || "http://127.0.0.1:8401";

const log = (msg) => stderr.write(`[aeqi-tenant-mcp] ${msg}\n`);

// ── HTTP helpers ────────────────────────────────────────────────────────────

async function http(method, path, body) {
  const url = `${RUNTIME_URL}${path}`;
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch (e) {
    return { ok: false, error: `non-JSON response: ${text.slice(0, 200)}` };
  }
  if (!res.ok && parsed && parsed.ok === undefined) {
    parsed.ok = false;
  }
  return parsed;
}

// ── Tool catalog ────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "ideas",
    description:
      "AEQI tenant knowledge store. Search, store, update, delete, link, list, or get ideas. Backed by sqlite + BM25 + vector. The AEQI tenant holds claude's memory layer (formerly ~/.claude/.../memory/*.md), C-suite personas, AEQI mission/vision, and quest stubs. Search via natural-language `query`. Filter via `tags`. Use `scope: 'global'` for tenant-wide notes; omit for agent-scoped.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["store", "search", "update", "delete", "link", "list", "get"],
          description:
            "store: save knowledge (needs name, content; optional tags, scope, agent_id). search: natural-language query (needs query; optional tags, limit). update: modify by id (needs id; optional name/content/tags). delete: remove by id (needs id). link: connect two ideas with a typed edge (needs source_id, target_id; optional relation=link, strength=1.0). list: enumerate (optional agent_id). get: fetch by id (needs id).",
        },
        id: { type: "string", description: "Idea id (for update/delete/get/link source)" },
        name: { type: "string", description: "Idea name slug (for store/update)" },
        content: { type: "string", description: "Idea body (for store/update)" },
        scope: {
          type: "string",
          enum: ["self", "global"],
          description: "Idea scope (for store). 'global' = tenant-wide (agent_id NULL). 'self' = agent-scoped (requires agent_id).",
        },
        agent_id: { type: "string", description: "Agent id for scoping (for store/list/search)" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tag list (for store/update). On search: hard filter via comma-joined query.",
        },
        query: { type: "string", description: "Natural-language search query (for search)" },
        limit: { type: "integer", description: "Max search results (for search; default 10)" },
        source_id: { type: "string", description: "Source idea id (for link)" },
        target_id: { type: "string", description: "Target idea id (for link)" },
        relation: {
          type: "string",
          enum: ["link", "mention", "embed"],
          description: "Edge relation (for link; default 'link')",
        },
        strength: { type: "number", description: "Edge strength 0–1 (for link; default 1.0)" },
      },
      required: ["action"],
    },
  },
];

// ── Tool dispatch ──────────────────────────────────────────────────────────

async function callIdeas(args) {
  const action = args.action || "search";
  switch (action) {
    case "store": {
      const body = {
        name: args.name,
        content: args.content || "",
        tags: args.tags || [],
      };
      if (args.scope) body.scope = args.scope;
      if (args.agent_id) body.agent_id = args.agent_id;
      return await http("POST", "/api/ideas", body);
    }
    case "search": {
      const params = new URLSearchParams();
      if (args.query) params.set("query", args.query);
      if (args.tags && args.tags.length > 0) params.set("tags", args.tags.join(","));
      if (args.limit) params.set("top_k", String(args.limit));
      if (args.agent_id) params.set("agent_id", args.agent_id);
      return await http("GET", `/api/ideas/search?${params.toString()}`);
    }
    case "list": {
      const params = new URLSearchParams();
      if (args.agent_id) params.set("agent_id", args.agent_id);
      const qs = params.toString();
      return await http("GET", `/api/ideas${qs ? `?${qs}` : ""}`);
    }
    case "get": {
      if (!args.id) return { ok: false, error: "id required" };
      // No direct GET-by-id; use search by name or fall back to list. Use prefix.
      return await http("GET", `/api/ideas/prefix?prefix=${encodeURIComponent(args.name || "")}&limit=1`);
    }
    case "update": {
      if (!args.id) return { ok: false, error: "id required" };
      const body = {};
      if (args.name !== undefined) body.name = args.name;
      if (args.content !== undefined) body.content = args.content;
      if (args.tags !== undefined) body.tags = args.tags;
      return await http("PUT", `/api/ideas/${encodeURIComponent(args.id)}`, body);
    }
    case "delete": {
      if (!args.id) return { ok: false, error: "id required" };
      return await http("DELETE", `/api/ideas/${encodeURIComponent(args.id)}`);
    }
    case "link": {
      const src = args.source_id || args.id;
      const tgt = args.target_id;
      if (!src || !tgt) return { ok: false, error: "source_id and target_id required" };
      const body = { target_id: tgt };
      if (args.relation) body.relation = args.relation;
      if (args.strength !== undefined) body.strength = args.strength;
      return await http("POST", `/api/ideas/${encodeURIComponent(src)}/edges`, body);
    }
    default:
      return { ok: false, error: `unknown action: ${action}` };
  }
}

// ── JSON-RPC 2.0 stdio loop ────────────────────────────────────────────────

const writeMsg = (obj) => {
  stdout.write(JSON.stringify(obj) + "\n");
};

const reply = (id, result, error) => {
  const msg = { jsonrpc: "2.0", id };
  if (error) msg.error = error;
  else msg.result = result;
  writeMsg(msg);
};

async function handle(req) {
  const { method, id, params = {} } = req;
  switch (method) {
    case "initialize":
      return reply(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "aeqi-tenant", version: "0.1.0" },
      });
    case "notifications/initialized":
      return; // no reply
    case "tools/list":
      return reply(id, { tools: TOOLS });
    case "tools/call": {
      const name = params.name;
      const args = params.arguments || {};
      if (name !== "ideas") {
        return reply(id, null, { code: -32601, message: `unknown tool: ${name}` });
      }
      try {
        const result = await callIdeas(args);
        return reply(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: result && result.ok === false,
        });
      } catch (e) {
        return reply(id, null, { code: -32603, message: e.message || String(e) });
      }
    }
    default:
      if (id !== undefined && id !== null) {
        return reply(id, null, { code: -32601, message: `method not supported: ${method}` });
      }
  }
}

const rl = readline.createInterface({ input: stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let req;
  try {
    req = JSON.parse(line);
  } catch (e) {
    log(`bad JSON: ${line.slice(0, 200)}`);
    return;
  }
  try {
    await handle(req);
  } catch (e) {
    log(`handler error: ${e.message || e}`);
    if (req.id !== undefined) {
      reply(req.id, null, { code: -32603, message: e.message || String(e) });
    }
  }
});

log(`bridge ready → ${RUNTIME_URL}`);
