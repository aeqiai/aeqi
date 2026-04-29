import { API_BASE_URL, ApiError, apiRequest as request, RateLimitedError } from "@/api/client";
import type { AppMode } from "@/lib/appMode";
import type {
  AgentEvent,
  CompanyTemplate,
  EventInvocationRow,
  Idea,
  InvocationStepRow,
  OccupantKind,
  Position,
  PositionEdge,
  Quest,
  ScopeValue,
} from "@/lib/types";
import type { AllowedChat } from "@/api/channels";
export { RateLimitedError };

export const api = {
  getAuthMode: () =>
    request<{
      app_mode?: AppMode;
      mode: string;
      google_oauth: boolean;
      github_oauth: boolean;
      waitlist: boolean;
    }>("/auth/mode"),

  login: (secret: string) =>
    request<{ ok: boolean; token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ secret }),
    }),

  loginWithEmail: (email: string, password: string) =>
    request<{
      ok: boolean;
      token: string;
      user?: Record<string, unknown>;
      pending_verification?: boolean;
      pending_2fa?: boolean;
      email?: string;
    }>("/auth/login/email", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  signup: (email: string, password: string, name: string, inviteCode?: string) =>
    request<{
      ok: boolean;
      token: string;
      user?: Record<string, unknown>;
      pending_verification?: boolean;
    }>("/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password, name, invite_code: inviteCode }),
    }),

  joinWaitlist: (email: string, honeypot: string = "") =>
    request<{ ok: boolean; message: string }>("/auth/waitlist", {
      method: "POST",
      body: JSON.stringify({ email, _hp: honeypot }),
    }),

  checkInviteCode: (code: string) =>
    request<{ ok: boolean; valid: boolean }>("/auth/invite/check", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),

  getInviteCodes: () =>
    request<{ ok: boolean; codes: Array<{ code: string; used: boolean }> }>("/auth/invite-codes"),

  getMe: () => request<Record<string, unknown>>("/auth/me"),

  deleteAccount: () => request<{ ok: boolean }>("/auth/delete-account", { method: "DELETE" }),

  setupTotp: () => request<Record<string, unknown>>("/auth/totp/setup", { method: "POST" }),

  verifyTotp: (code: string) =>
    request<Record<string, unknown>>("/auth/totp/verify", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),

  loginTotp: (email: string, code: string) =>
    request<Record<string, unknown>>("/auth/totp/login", {
      method: "POST",
      body: JSON.stringify({ email, code }),
    }),

  disableTotp: (password: string, code: string) =>
    request<{ ok: boolean }>("/auth/totp/disable", {
      method: "POST",
      body: JSON.stringify({ password, code }),
    }),

  getActivity: () => request<Record<string, unknown>>("/auth/activity"),

  getAuthSessions: () => request<Record<string, unknown>>("/auth/sessions"),

  revokeAuthSession: (jti: string) =>
    request<{ ok: boolean }>("/auth/sessions/revoke", {
      method: "POST",
      body: JSON.stringify({ jti }),
    }),

  revokeOtherAuthSessions: () =>
    request<{ ok: boolean; revoked: number }>("/auth/sessions/revoke-others", {
      method: "POST",
    }),

  updateAvatar: (dataUrl: string) =>
    request<{ ok: boolean }>("/auth/update-avatar", {
      method: "POST",
      body: JSON.stringify({ avatar: dataUrl }),
    }),

  updateProfile: (first_name: string, last_name: string, phone: string) =>
    request<{ ok: boolean }>("/auth/update-profile", {
      method: "POST",
      body: JSON.stringify({ first_name, last_name, phone }),
    }),

  updatePhishingCode: (code: string) =>
    request<{ ok: boolean }>("/auth/phishing-code", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),

  changePassword: (current_password: string, new_password: string) =>
    request<{ ok: boolean }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ current_password, new_password }),
    }),

  verifyEmail: (email: string, code: string) =>
    request<{ ok: boolean; token: string; user?: Record<string, unknown> }>("/auth/verify", {
      method: "POST",
      body: JSON.stringify({ email, code }),
    }),

  resendCode: (email: string) =>
    request<{ ok: boolean }>("/auth/resend-code", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  verify2fa: (email: string, code: string) =>
    request<{ ok: boolean; token: string; user?: Record<string, unknown> }>("/auth/2fa/verify", {
      method: "POST",
      body: JSON.stringify({ email, code }),
    }),

  resend2fa: (email: string) =>
    request<{ ok: boolean }>("/auth/2fa/resend", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  forgotPassword: (email: string) =>
    request<{ ok: boolean }>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  resetPassword: (token: string, password: string) =>
    request<{ ok: boolean }>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    }),

  getDashboard: () => request<Record<string, unknown>>("/dashboard"),

  getStatus: () => request<Record<string, unknown>>("/status"),

  getActivityEvents: (params?: { cursor?: number }) => {
    const query = new URLSearchParams();
    if (params?.cursor != null) query.set("cursor", String(params.cursor));
    const qs = query.toString();
    return request<Record<string, unknown>>(`/activity/events${qs ? `?${qs}` : ""}`);
  },

  getEntities: () => request<Record<string, unknown>>("/entities"),
  createEntity: (data: { name: string; tagline?: string; prefix?: string }) =>
    request<Record<string, unknown>>("/entities", { method: "POST", body: JSON.stringify(data) }),
  updateEntity: (name: string, data: { name?: string; tagline?: string; logo_url?: string }) =>
    request<{ ok: boolean }>(`/entities/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify({
        ...data,
        ...(data.name ? { new_name: data.name } : {}),
      }),
    }),

  // Positions — the org-chart primitive. Returns the full set of positions +
  // edges for the entity so the caller can render either a flat list or a DAG.
  getPositions: (entityId: string) =>
    request<{ ok: boolean; positions: Position[]; edges: PositionEdge[] }>(
      `/positions?entity_id=${encodeURIComponent(entityId)}`,
    ),
  createPosition: (data: {
    entity_id: string;
    title: string;
    occupant_kind: OccupantKind;
    occupant_id?: string;
    parent_position_id?: string;
  }) =>
    request<{ ok: boolean; position: Position }>("/positions", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getQuests: (params?: { status?: string; root?: string }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (params?.root) query.set("root", params.root);
    const qs = query.toString();
    return request<Record<string, unknown>>(`/quests${qs ? `?${qs}` : ""}`);
  },

  getAgents: (params?: { root?: boolean }) =>
    request<Record<string, unknown>>(params?.root ? "/agents?root=true" : "/agents"),

  getActivityStream: (params?: { last?: number; root?: string }) => {
    const query = new URLSearchParams();
    if (params?.last) query.set("last", String(params.last));
    if (params?.root) query.set("root", params.root);
    const qs = query.toString();
    return request<Record<string, unknown>>(`/activity${qs ? `?${qs}` : ""}`);
  },

  getExpertise: (domain?: string) => {
    const query = new URLSearchParams();
    if (domain) query.set("domain", domain);
    const qs = query.toString();
    return request<Record<string, unknown>>(`/expertise${qs ? `?${qs}` : ""}`);
  },

  getCost: () => request<Record<string, unknown>>("/cost"),

  getIdeas: (params?: { root?: string; query?: string; limit?: number; agent_id?: string }) => {
    const q = new URLSearchParams();
    if (params?.root) q.set("root", params.root);
    if (params?.query) q.set("query", params.query);
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.agent_id) q.set("agent_id", params.agent_id);
    const qs = q.toString();
    return request<Record<string, unknown>>(`/ideas${qs ? `?${qs}` : ""}`);
  },

  getSkills: () => request<Record<string, unknown>>("/ideas/search?tags=skill"),

  // Agent Channels — typed connector config, first-class rows in the
  // `channels` table. `config` is a tagged enum validated server-side.
  getAgentChannels: (agentId: string) =>
    request<Record<string, unknown>>(`/agents/${encodeURIComponent(agentId)}/channels`),
  createAgentChannel: (params: {
    agent_id: string;
    config: Record<string, unknown> & { kind: string };
  }) =>
    request<Record<string, unknown>>(`/agents/${encodeURIComponent(params.agent_id)}/channels`, {
      method: "POST",
      body: JSON.stringify({ config: params.config }),
    }),
  updateAgentChannel: (params: {
    agent_id: string;
    config: Record<string, unknown> & { kind: string };
  }) =>
    // Upsert replaces the existing row for (agent_id, kind).
    request<Record<string, unknown>>(`/agents/${encodeURIComponent(params.agent_id)}/channels`, {
      method: "POST",
      body: JSON.stringify({ config: params.config }),
    }),
  // Tenancy is resolved server-side from the row's owner — no agent_id body.
  deleteAgentChannel: (id: string) =>
    request<Record<string, unknown>>(`/channels/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  // Replace the channel's allowed_chats whitelist. Empty array = no
  // restriction. Writes to the dedicated `channel_allowed_chats` table —
  // does not touch the config blob. Each entry carries a `reply_allowed`
  // flag: `true` = auto-reply, `false` = read-only (receive but stay silent).
  // The IPC accepts either the legacy `string[]` or the typed shape; we
  // always send the typed shape going forward.
  setChannelAllowedChats: (id: string, chats: AllowedChat[]) =>
    request<Record<string, unknown>>(`/channels/${encodeURIComponent(id)}/allowed-chats`, {
      method: "PATCH",
      body: JSON.stringify({ chat_ids: chats }),
    }),
  // WhatsApp Baileys pairing: poll for QR + connection state. Returns
  // `{ status: null }` while the gateway task hasn't registered yet
  // (e.g., daemon just restarted).
  getChannelBaileysStatus: (id: string) =>
    request<{
      ok: boolean;
      status: null | {
        state: "spawning" | "connecting" | "awaiting_qr" | "ready" | "disconnected";
        qr: string | null;
        qr_data_url: string | null;
        last_reason: string | null;
        me: string | null;
      };
    }>(`/channels/${encodeURIComponent(id)}/baileys-status`),
  // Force-disconnect a Baileys channel and wipe its auth state on disk.
  // The user will need to re-scan a QR before it sends/receives again.
  logoutChannelBaileys: (id: string) =>
    request<{ ok: boolean; logged_out?: boolean }>(
      `/channels/${encodeURIComponent(id)}/baileys-logout`,
      { method: "POST" },
    ),
  getChannelSessions: (agentId: string) =>
    request<Record<string, unknown>>(`/channel-sessions?agent_id=${encodeURIComponent(agentId)}`),
  updateIdea: (id: string, body: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/ideas/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  getIdeaGraph: (params?: { agent_id?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.agent_id) q.set("agent_id", params.agent_id);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<Record<string, unknown>>(`/ideas/graph${qs ? `?${qs}` : ""}`);
  },

  getIdeaProfile: (params?: { root?: string }) => {
    const q = new URLSearchParams();
    if (params?.root) q.set("root", params.root);
    const qs = q.toString();
    return request<Record<string, unknown>>(`/ideas/profile${qs ? `?${qs}` : ""}`);
  },

  storeIdea: (data: {
    name: string;
    content: string;
    tags?: string[];
    agent_id?: string;
    scope?: ScopeValue;
    links?: string[];
  }) =>
    request<{ ok: boolean; id: string }>("/ideas", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Returns `{ ok: false, error: "in_use", quest_ids }` (HTTP 200) when
  // the idea is FK'd from one or more quests — the cross-DB pre-flight
  // can't translate to a real 4xx without breaking the existing
  // ipc_proxy contract, so the caller checks `error === "in_use"`.
  deleteIdea: (id: string) =>
    request<{ ok: boolean; error?: string; quest_ids?: string[] }>(
      `/ideas/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),

  // Idea edges: outgoing links + incoming backlinks for a single idea.
  getIdeaEdges: (id: string) =>
    request<import("./types").IdeaEdges>(`/ideas/${encodeURIComponent(id)}/edges`),

  addIdeaEdge: (sourceId: string, targetId: string, relation: string = "adjacent") =>
    request<{ ok: boolean }>(`/ideas/${encodeURIComponent(sourceId)}/edges`, {
      method: "POST",
      body: JSON.stringify({ target_id: targetId, relation }),
    }),

  removeIdeaEdge: (sourceId: string, targetId: string, relation?: string) =>
    request<{ ok: boolean }>(`/ideas/${encodeURIComponent(sourceId)}/edges`, {
      method: "DELETE",
      body: JSON.stringify(relation ? { target_id: targetId, relation } : { target_id: targetId }),
    }),

  getAgentIdentity: (name: string) => request<Record<string, unknown>>(`/agents/${name}/identity`),
  saveAgentFile: (name: string, filename: string, content: string) =>
    request<{ ok: boolean }>(`/agents/${name}/files`, {
      method: "POST",
      body: JSON.stringify({ filename, content }),
    }),

  getRateLimit: () => request<Record<string, unknown>>("/rate-limit"),

  getHealth: () => request<{ ok: boolean }>("/health"),

  createQuest: (data: {
    project: string;
    /**
     * Phase-2 unification: prefer one of the two `idea*` shapes over the
     * legacy `subject`/`description` flow.
     *
     *   • `idea: { name, content, scope?, agent_id?, tags? }` — Flow A
     *     mints a fresh idea row, then wraps a quest around it.
     *   • `idea_id: "..."` — Flow B wraps an existing idea.
     */
    idea?: {
      name: string;
      content?: string;
      scope?: string;
      agent_id?: string;
      tags?: string[];
    };
    idea_id?: string;
    /** Legacy. Subject/description are used only when idea/idea_id are absent. */
    subject?: string;
    description?: string;
    priority?: string;
    scope?: string;
    acceptance_criteria?: string;
    agent_id?: string;
    agent?: string;
  }) =>
    request<{ ok: boolean; quest: Quest; idea?: Idea; error?: string }>("/quests", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  createQuestPreset: (
    kind: "feature-dev" | "bug-fix" | "refactor",
    data: {
      subject: string;
      project: string;
      agent?: string;
      agent_id?: string;
      symptom?: string;
      motivation?: string;
    },
  ) =>
    request<Record<string, unknown>>(`/quests/presets/${kind}`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateQuest: (
    id: string,
    data: {
      description?: string;
      status?: string;
      priority?: string;
      labels?: string[];
      agent_id?: string;
      /** Polymorphic. `agent:<id>` / `user:<id>` / `null` (unassign). */
      assignee?: string | null;
      scope?: string;
    },
  ) =>
    request<{ ok: boolean }>(`/quests/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  closeQuest: (id: string, data?: { reason?: string; root?: string }) =>
    request<{ ok: boolean }>(`/quests/${id}/close`, {
      method: "POST",
      body: JSON.stringify(data ? { reason: data.reason, root: data.root } : {}),
    }),

  // Assembles the system prompt without creating the quest — used by the
  // composer to preview what the agent will see before commit.
  questPreflight: (data: { agent_id: string; description: string; task_idea_ids?: string[] }) =>
    request<{ ok: boolean; system: string; tools: { allow: string[]; deny: string[] } }>(
      "/quests/preflight",
      { method: "POST", body: JSON.stringify(data) },
    ),

  getQuest: (id: string) => request<{ ok: boolean; quest: Quest; idea?: Idea }>(`/quests/${id}`),

  getSessions: (agentId?: string) => {
    const q = new URLSearchParams();
    if (agentId) q.set("agent_id", agentId);
    const qs = q.toString();
    return request<Record<string, unknown>>(`/sessions${qs ? `?${qs}` : ""}`);
  },
  createSession: (agentId: string) =>
    request<Record<string, unknown>>("/sessions", {
      method: "POST",
      body: JSON.stringify({ agent_id: agentId }),
    }),
  sendSessionMessage: (data: {
    message: string;
    agent?: string;
    agent_id?: string;
    session_id?: string;
    session_ideas?: string[];
    quest_id?: string;
    files?: Array<{ name: string; content: string }>;
  }) =>
    request<Record<string, unknown>>("/sessions/send", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Blueprints — pre-threaded company bundles. Spawn creates an entity
  // backed by a root agent today and returns the canonical entity id.
  getBlueprints: () => request<{ ok: boolean; blueprints: CompanyTemplate[] }>("/blueprints"),

  // Full Template including seed_agents/events/ideas/quests arrays. The
  // list endpoint returns counts only to keep the catalog payload small;
  // the detail endpoint is what the store calls when a card is selected.
  getBlueprint: (slug: string) =>
    request<{ ok: boolean; blueprint: CompanyTemplate }>(`/blueprints/${encodeURIComponent(slug)}`),

  // Resolves the operator-configured default Blueprint
  // (`[blueprints] default` in aeqi.toml). Used by `/start` when the
  // user lands there without a `?blueprint=:slug` query param.
  getDefaultBlueprint: () =>
    request<{ ok: boolean; blueprint: CompanyTemplate }>("/blueprints/default"),

  spawnBlueprint: (data: { blueprint: string; name?: string }) =>
    request<{ ok: boolean; entity_id: string }>("/blueprints/spawn", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Spawn a Blueprint INTO an existing entity. Powers `+ New agent`: the
  // blueprint's root attaches under the entity's root agent; seeds nest
  // under that root. Same blueprint JSON, different destination.
  spawnBlueprintIntoEntity: (data: { blueprint: string; entity_id: string }) =>
    request<{
      ok: boolean;
      spawned_agents: number;
      created_events: number;
      created_ideas: number;
      created_quests: number;
    }>("/blueprints/spawn-into", { method: "POST", body: JSON.stringify(data) }),

  // Platform-side launch — mints the canonical entity_id (UUID)
  // synchronously and kicks off the sandbox provisioner async. The
  // frontend can navigate to `/c/<entity_id>/...` immediately; the
  // placement's `status` field flips from `pending` to `ready` once
  // provisioning completes.
  startLaunch: (data: { template: string; display_name: string }) =>
    request<{ ok: boolean; entity_id: string; display_name: string }>("/start/launch", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  spawnAgent: (data: {
    name: string;
    template?: string;
    project?: string;
    parent_agent_id?: string;
    system_prompt?: string;
  }) =>
    request<{
      ok: boolean;
      agent: { id: string; name: string; entity_id?: string | null; status?: string };
      warnings?: string[];
    }>("/agents/spawn", { method: "POST", body: JSON.stringify(data) }),

  // Delete Agent — cascade wipes the subtree; reparent (default) promotes
  // children to the grandparent. Returns { ok, deleted, cascade } on success.
  deleteAgent: (agentId: string, opts?: { cascade?: boolean }) =>
    request<{ ok: boolean; deleted?: number; cascade?: boolean; error?: string }>(
      `/agents/${encodeURIComponent(agentId)}?cascade=${opts?.cascade ? "true" : "false"}`,
      { method: "DELETE" },
    ),

  closeSession: (sessionId: string) =>
    request<{ ok: boolean }>(`/sessions/${sessionId}/close`, { method: "POST" }),
  cancelSession: (sessionId: string) =>
    request<{ ok: boolean; cancelled: boolean }>(`/sessions/${sessionId}/cancel`, {
      method: "POST",
    }),
  isSessionActive: (sessionId: string) =>
    request<{ ok: boolean; active: boolean }>(`/sessions/${sessionId}/active`),
  forkSession: (sessionId: string, messageId: number) =>
    request<{ ok: boolean; session_id: string }>(`/sessions/${sessionId}/fork`, {
      method: "POST",
      body: JSON.stringify({ message_id: messageId }),
    }),

  setAgentModel: (agentId: string, model: string) =>
    request<{ ok: boolean }>(`/agents/${agentId}/model`, {
      method: "PUT",
      body: JSON.stringify({ model }),
    }),

  // Model catalog — provider-agnostic list for the agent model picker. Slugs
  // follow `{family}/{model-id}` (anthropic, google, deepseek, ollama, …).
  getModels: () =>
    request<{
      ok: boolean;
      models: Array<{
        id: string;
        display_name: string;
        family: string;
        tier: "free" | "cheap" | "balanced" | "premium";
        context_window: number;
        price_in: number;
        price_out: number;
        notes: string;
        recommended: boolean;
        tags: string[];
      }>;
    }>("/models"),

  setAgentTools: (agentId: string, toolDeny: string[]) =>
    request<{ ok: boolean }>(`/agents/${agentId}/tools`, {
      method: "PUT",
      body: JSON.stringify({ tool_deny: toolDeny }),
    }),

  setCanAskDirector: (agentId: string, value: boolean) =>
    request<{ ok: boolean; error?: string }>(
      `/agents/${encodeURIComponent(agentId)}/can-ask-director`,
      {
        method: "POST",
        body: JSON.stringify({ value }),
      },
    ),

  getIdeasByIds: (ids: string[]) =>
    request<{
      ok: boolean;
      ideas: Array<{
        id: string;
        name: string;
        content: string;
        tags: string[];
        agent_id?: string;
        scope?: ScopeValue;
      }>;
    }>("/ideas/by-ids", { method: "POST", body: JSON.stringify({ ids }) }),

  getAgentEvents: (agentId: string) =>
    request<Record<string, unknown>>(`/events?agent_id=${encodeURIComponent(agentId)}`),
  getEvent: (id: string) => request<{ ok: boolean; event: AgentEvent }>(`/events/${id}`),
  createEvent: (data: Record<string, unknown>) =>
    request<{ ok: boolean; event: AgentEvent }>("/events", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateEvent: (id: string, data: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/events/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteEvent: (id: string) =>
    request<Record<string, unknown>>(`/events/${id}`, { method: "DELETE" }),

  triggerEvent: (
    agentRef: { agent: string } | { agent_id: string },
    pattern: string,
    extra?: Record<string, unknown>,
  ) =>
    request<{
      ok: boolean;
      agent_id: string;
      pattern: string;
      system_prompt: string;
      matched_events: Record<string, unknown>[];
    }>("/events/trigger", {
      method: "POST",
      body: JSON.stringify({ ...agentRef, pattern, ...extra }),
    }),

  listInvocations: (sessionId: string, limit = 50) =>
    request<{
      ok: boolean;
      invocations: EventInvocationRow[];
    }>(`/events/trace?session_id=${encodeURIComponent(sessionId)}&limit=${limit}`),
  listInvocationsForEvent: (eventName: string, pattern: string, limit = 50) =>
    request<{
      ok: boolean;
      invocations: EventInvocationRow[];
    }>(
      `/events/trace?event_name=${encodeURIComponent(eventName)}` +
        `&pattern=${encodeURIComponent(pattern)}&limit=${limit}`,
    ),
  getInvocationDetail: (invocationId: number) =>
    request<{
      ok: boolean;
      invocation: EventInvocationRow;
      steps: InvocationStepRow[];
    }>("/events/trace", {
      method: "POST",
      body: JSON.stringify({ invocation_id: invocationId }),
    }),

  getSessionChildren: (sessionId: string) =>
    request<Record<string, unknown>>(`/sessions/${sessionId}/children`),

  getSessionMessages: (sessionId: string, limit = 50) =>
    request<Record<string, unknown>>(`/sessions/${sessionId}/messages?limit=${limit}`),

  generateApiKey: () =>
    request<{ ok: boolean; id: string; api_key: string; rotated: boolean }>("/account/api-key", {
      method: "POST",
    }),

  getKeys: () =>
    request<{
      ok: boolean;
      keys: Array<{
        id: string;
        prefix: string;
        root: string;
        name: string;
        created_at: string;
        last_used_at: string | null;
      }>;
    }>("/keys"),

  createKey: (data: { root: string; name: string }) =>
    request<{ ok: boolean; id: string; secret_key: string }>("/keys", {
      method: "POST",
      body: JSON.stringify({ root: data.root, name: data.name }),
    }),

  revokeKey: (id: string) => request<{ ok: boolean }>(`/keys/${id}`, { method: "DELETE" }),

  // Drive — per-agent file storage. Access follows the agent's visibility:
  // if you can see the agent, you can see its files.
  listDriveFiles: (agentId: string) =>
    request<{
      ok: boolean;
      files: Array<{
        id: string;
        agent_id: string;
        name: string;
        mime: string;
        size_bytes: number;
        uploaded_by: string | null;
        uploaded_at: string;
      }>;
    }>(`/agents/${encodeURIComponent(agentId)}/drive`),

  /** Upload a single file to an agent's drive. Reads the File as a
   * base64 string client-side and POSTs JSON — the server decodes and
   * stores. Limit: 25 MiB per file (enforced server-side). */
  uploadDriveFile: async (agentId: string, file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Chunked base64 encode — avoids the "argument list too long" stack error
    // btoa() throws on for single-shot large TypedArrays.
    let binary = "";
    const CHUNK = 32_768;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    const content_b64 = btoa(binary);
    return request<{ ok: boolean; file?: unknown; error?: string }>(
      `/agents/${encodeURIComponent(agentId)}/drive`,
      {
        method: "POST",
        body: JSON.stringify({
          name: file.name,
          mime: file.type || "application/octet-stream",
          content_b64,
        }),
      },
    );
  },

  driveDownloadUrl: (fid: string) => `${API_BASE_URL}/drive/${encodeURIComponent(fid)}`,

  deleteDriveFile: (fid: string) =>
    request<{ ok: boolean; deleted?: boolean }>(`/drive/${encodeURIComponent(fid)}`, {
      method: "DELETE",
    }),

  // Stripe billing — per-Company subscriptions. Plans use public IDs
  // (launch / scale / free) which map to backend IDs (starter / growth / free)
  // via lib/pricing.ts BACKEND_PLAN_ID. Frontend always speaks public IDs;
  // the helper does the mapping.
  createCheckoutSession: (data: {
    plan: "launch" | "scale";
    interval: "monthly" | "annual";
    blueprint?: string;
    root_slug?: string;
  }) =>
    request<{ url: string }>("/billing/checkout", {
      method: "POST",
      body: JSON.stringify({
        plan: data.plan === "launch" ? "starter" : "growth",
        interval: data.interval,
        blueprint: data.blueprint,
        root_slug: data.root_slug,
      }),
    }),

  openBillingPortal: () => request<{ url: string }>("/billing/portal", { method: "POST" }),

  getBillingOverview: () =>
    request<{
      ok: boolean;
      total_monthly_cents: number;
      total_annual_cents: number;
      currency: string;
      payment_method_last4: string | null;
      companies: Array<{
        name: string;
        agent_id: string | null;
        plan: "launch" | "scale" | "free";
        stripe_subscription_id: string | null;
        status: "active" | "trialing" | "past_due" | "canceled" | "free";
        next_charge_at: string | null;
      }>;
    }>("/billing/overview"),

  // TODO: backend endpoint pending — used by /settings/billing per-Company actions.
  getCompanySubscription: (rootName: string) =>
    request<{
      name: string;
      plan: "launch" | "scale" | "free";
      status: string;
      stripe_subscription_id: string | null;
    }>(`/billing/companies/${encodeURIComponent(rootName)}`),

  getInbox: () => request<{ ok: boolean; items: InboxItem[] }>("/inbox"),

  answerInbox: (sessionId: string, answer: string) =>
    request<{ ok: boolean; session_id?: string; error?: string }>(
      `/inbox/${encodeURIComponent(sessionId)}/answer`,
      {
        method: "POST",
        body: JSON.stringify({ answer }),
      },
    ),
};

/// One row of the director-inbox query — see `crates/aeqi-orchestrator/src/ipc/inbox.rs`.
/// `agent_name` and `entity_id` are joined server-side; `last_agent_message`
/// is the truncated assistant message that immediately precedes the ask.
export interface InboxItem {
  session_id: string;
  agent_id: string | null;
  agent_name: string | null;
  entity_id: string | null;
  session_name: string;
  awaiting_subject: string | null;
  awaiting_at: string;
  last_agent_message: string | null;
}

export { ApiError };
