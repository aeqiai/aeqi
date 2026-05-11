import { API_BASE_URL, ApiError, apiRequest as request, RateLimitedError } from "@/api/client";
import type { AppMode } from "@/lib/appMode";
import type {
  AgentEvent,
  Blueprint,
  EventInvocationRow,
  Idea,
  InferenceCallRow,
  InvitationDetail,
  InvocationStepRow,
  OccupantKind,
  Role,
  RoleEdge,
  RoleInvitation,
  RoleOverride,
  RoleType,
  Quest,
  ScopeValue,
  StackProvisionResult,
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

  requestLoginCode: (email: string) =>
    request<{ ok: boolean }>("/auth/login/code/request", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  consumeLoginCode: (email: string, code: string) =>
    request<{ ok: boolean; token: string; user?: Record<string, unknown> }>(
      "/auth/login/code/consume",
      {
        method: "POST",
        body: JSON.stringify({ email, code }),
      },
    ),

  consumeMagicLink: (token: string) =>
    request<{ ok: boolean; token: string; user?: Record<string, unknown> }>(
      "/auth/login/magic/consume",
      {
        method: "POST",
        body: JSON.stringify({ token }),
      },
    ),

  signup: (
    email: string,
    password: string,
    name: string,
    inviteCode?: string,
    invitationToken?: string,
  ) =>
    request<{
      ok: boolean;
      token: string;
      user?: Record<string, unknown>;
      pending_verification?: boolean;
      invitation_token?: string;
    }>("/auth/signup", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        name,
        invite_code: inviteCode,
        ...(invitationToken ? { invitation_token: invitationToken } : {}),
      }),
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

  createInviteCode: () =>
    request<{ ok: boolean; code: string }>("/auth/invite-codes", { method: "POST" }),

  getAdminOverview: () =>
    request<{
      ok: boolean;
      users: Array<Record<string, unknown>>;
      placements: Array<Record<string, unknown>>;
      invite_codes: Array<Record<string, unknown>>;
      waitlist: Array<Record<string, unknown>>;
    }>("/admin/overview"),

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
  updateEntity: (
    name: string,
    data: {
      name?: string;
      tagline?: string;
      logo_url?: string;
      public?: boolean;
    },
  ) =>
    request<{ ok: boolean }>(`/entities/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify({
        ...data,
        ...(data.name ? { new_name: data.name } : {}),
      }),
    }),

  // Roles — the org-chart primitive. Returns the full set of roles +
  // edges for the entity so the caller can render either a flat list or
  // a DAG.
  getRoles: async (entityId: string) => {
    const r = await request<{
      ok: boolean;
      roles: Role[];
      edges: RoleEdge[];
    }>(`/roles?entity_id=${encodeURIComponent(entityId)}`);
    return {
      ok: r.ok,
      roles: r.roles,
      edges: r.edges,
    };
  },

  getRole: (roleId: string) =>
    request<{ ok: boolean; role: Role }>(`/roles/${encodeURIComponent(roleId)}`),

  createRole: (data: {
    entity_id: string;
    title: string;
    occupant_kind: OccupantKind;
    occupant_id?: string;
    parent_role_id?: string;
    role_type?: RoleType;
    grants?: string[];
  }) => {
    const wire = {
      entity_id: data.entity_id,
      title: data.title,
      occupant_kind: data.occupant_kind,
      ...(data.occupant_id ? { occupant_id: data.occupant_id } : {}),
      ...(data.parent_role_id ? { parent_role_id: data.parent_role_id } : {}),
      ...(data.role_type ? { role_type: data.role_type } : {}),
      ...(data.grants ? { grants: data.grants } : {}),
    };
    return request<{ ok: boolean; role: Role }>("/roles", {
      method: "POST",
      body: JSON.stringify(wire),
    });
  },

  updateRole: (roleId: string, patch: { title?: string; role_type?: string; grants?: string[] }) =>
    request<{ ok: boolean }>(`/roles/${encodeURIComponent(roleId)}/update`, {
      method: "POST",
      body: JSON.stringify(patch),
    }),

  archiveRole: (roleId: string) =>
    request<{ ok: boolean }>(`/roles/${encodeURIComponent(roleId)}/archive`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  assignRoleOccupant: (
    roleId: string,
    data: { occupant_kind: OccupantKind; occupant_id?: string },
  ) =>
    request<{ ok: boolean }>(`/roles/${encodeURIComponent(roleId)}/occupant`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getUserGrants: (entityId: string, userId: string) =>
    request<{ ok: boolean; grants: string[] }>(
      `/roles/grants?entity_id=${encodeURIComponent(entityId)}&user_id=${encodeURIComponent(userId)}`,
    ),

  // Invitation endpoints — platform-side, no entity scope in the path
  // for the public-facing ones.
  createRoleInvitation: (
    entityId: string,
    roleId: string,
    data: {
      target_kind: "email" | "slug" | "open";
      target_email?: string;
      target_entity_id?: string;
      welcome_note?: string;
    },
  ) =>
    request<{ ok: boolean; invitation: RoleInvitation }>(
      `/entities/${encodeURIComponent(entityId)}/roles/${encodeURIComponent(roleId)}/invitations`,
      { method: "POST", body: JSON.stringify(data) },
    ),

  listEntityInvitations: (entityId: string) =>
    request<{ ok: boolean; invitations: RoleInvitation[] }>(
      `/entities/${encodeURIComponent(entityId)}/invitations`,
    ),

  getInvitation: (token: string) =>
    request<{ ok: boolean; invitation: InvitationDetail }>(
      `/invitations/${encodeURIComponent(token)}`,
    ),

  acceptInvitation: (token: string, asEntityId: string) =>
    request<{ ok: boolean }>(`/invitations/${encodeURIComponent(token)}/accept`, {
      method: "POST",
      body: JSON.stringify({ as_entity_id: asEntityId }),
    }),

  declineInvitation: (token: string) =>
    request<{ ok: boolean }>(`/invitations/${encodeURIComponent(token)}/decline`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  getDirectedEntities: () =>
    request<{ ok: boolean; entities: Array<{ entity_id: string; display_name: string }> }>(
      `/me/directed-entities`,
    ),

  getQuests: (params?: { status?: string; root?: string }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (params?.root) query.set("root", params.root);
    const qs = query.toString();
    return request<Record<string, unknown>>(`/quests${qs ? `?${qs}` : ""}`);
  },

  getAgents: (params?: { root?: boolean }) =>
    request<Record<string, unknown>>(params?.root ? "/agents?root=true" : "/agents"),

  getAgentRecentInferenceCalls: (agentId: string, limit?: number) => {
    const qs = limit ? `?limit=${limit}` : "";
    return request<{ ok: boolean; calls?: InferenceCallRow[]; error?: string }>(
      `/agents/${encodeURIComponent(agentId)}/inference-calls${qs}`,
    );
  },

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
      /** RFC3339 UTC string to set, or `null` to clear the due-date. Omit
       * to leave unchanged. Phase-2 due_at column. */
      due_at?: string | null;
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

  // Public economy discovery. Lists every Company with `public=true` on
  // its placement — display_name + tagline + on-chain TRUST address. No
  // auth required (this is the front door). Treasury / token / liquidity
  // data is NOT returned today; the on-chain Solana modules backing those
  // surfaces (aeqi_treasury, UniFutures, DEX adapter) are not deployed
  // yet. When they ship, extend this payload.
  listEconomy: () =>
    request<{
      entities: Array<{
        entity_id: string;
        agent_id: string | null;
        display_name: string;
        tagline: string | null;
        trust_address: string | null;
        created_at: string;
      }>;
    }>("/economy/list"),

  // Blueprints — pre-threaded company bundles. Spawn creates an entity
  // backed by a root agent today and returns the canonical entity id.
  getBlueprints: () => request<{ ok: boolean; blueprints: Blueprint[] }>("/blueprints"),

  // Full Template including seed_agents/events/ideas/quests arrays. The
  // list endpoint returns counts only to keep the catalog payload small;
  // the detail endpoint is what the store calls when a card is selected.
  getBlueprint: (blueprintId: string) =>
    request<{ ok: boolean; blueprint: Blueprint }>(
      `/blueprints/${encodeURIComponent(blueprintId)}`,
    ),

  // Resolves the operator-configured default Blueprint
  // (`[blueprints] default` in aeqi.toml). Used by `/start` when the
  // user lands there without a `?blueprintId=` query param.
  getDefaultBlueprint: () => request<{ ok: boolean; blueprint: Blueprint }>("/blueprints/default"),

  /** `role_overrides` lets the operator stage occupants before the spawn
   *  commits — swap a default agent for themselves (human), or leave a
   *  role vacant. Each override targets a `role_key` declared in the
   *  template's `seed_roles`. Unknown keys silently warn server-side. */
  spawnBlueprint: (data: {
    blueprint: string;
    display_name?: string;
    role_overrides?: RoleOverride[];
  }) =>
    request<{ ok: boolean; entity_id: string }>("/blueprints/spawn", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Spawn a Blueprint INTO an existing entity. Powers `+ New agent` (full
  // company merge) and Import-from-blueprint on Ideas / Quests (scoped
  // via `parts`). Server defaults to all four parts when `parts` is
  // omitted; pass e.g. `["ideas"]` to materialize only seed_ideas.
  spawnBlueprintIntoEntity: (data: { blueprint: string; entity_id: string; parts?: string[] }) =>
    request<{
      ok: boolean;
      spawned_agents: number;
      created_events: number;
      created_ideas: number;
      created_quests: number;
    }>("/blueprints/spawn-into", { method: "POST", body: JSON.stringify(data) }),

  // Platform-side launch — mints the canonical entity_id (UUID) on the
  // platform host and provisions a sandbox runtime. Only callable by users
  // with subscription_status="invited" (sandbox tier) or "active" (paid).
  // Anyone else gets 402 PAYMENT_REQUIRED — they go through Stripe via
  // createCheckoutSession instead.
  startLaunch: (data: {
    template: string;
    display_name: string;
    mission?: string;
    plan?: string;
  }) =>
    request<{ ok: boolean; entity_id: string; display_name: string }>("/start/launch", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Stack blueprint provisioning — spawns N companies in dependency order.
  // `names` maps slot → display_name; falls back to component defaults.
  // Partial success: ok:true even when some components fail. Check each
  // component's status field. Requires active subscription or invite tier.
  startStack: (data: { stack_id: string; names: Record<string, string> }) =>
    request<StackProvisionResult>("/start/stack", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Fetch full stack blueprint detail by id (includes all components + edges).
  getStack: (id: string) =>
    request<{ ok: boolean; stack: unknown }>(`/stacks/${encodeURIComponent(id)}`),

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

  // Stripe billing. Launch flows can stamp `plan` / `mission` metadata
  // for provisioning and return via the launch completion redirect; the
  // Billing settings surfaces keep their existing behavior.
  createCheckoutSession: (data: {
    blueprint?: string;
    // not entity_id — entity is minted post-checkout when user lands on /start.
    display_name?: string;
    mission?: string;
    plan?: string;
    launch?: boolean;
    role_overrides?: unknown[];
  }) =>
    request<{ url: string }>("/billing/checkout", {
      method: "POST",
      body: JSON.stringify({
        blueprint: data.blueprint,
        display_name: data.display_name,
        mission: data.mission,
        plan: data.plan,
        launch: data.launch,
        role_overrides: data.role_overrides,
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
        plan: "company";
        stripe_subscription_id: string | null;
        status: "active" | "trialing" | "past_due" | "canceled";
        next_charge_at: string | null;
      }>;
    }>("/billing/overview"),

  // TODO: backend endpoint pending — used by /settings/billing per-Company actions.
  getCompanySubscription: (rootName: string) =>
    request<{
      name: string;
      plan: "company";
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

  dismissInbox: (sessionId: string) =>
    request<{ ok: boolean; error?: string }>(`/inbox/${encodeURIComponent(sessionId)}/dismiss`, {
      method: "POST",
    }),

  // ── Budgets — the role-budget primitive (WS-B2 / B6 / canonical brief
  // architecture_role_budget_canonical.md). Reads require treasury.read at
  // the trust; mutations require occupant of the budget's owner role.
  // `idempotency_key` on mutations dedupes retries within an epoch.
  listBudgets: (
    trustId: string,
    filters: { ownerRoleId?: string; parentBudgetId?: string; isPrimary?: boolean } = {},
  ) => {
    const params = new URLSearchParams({ trust_id: trustId });
    if (filters.ownerRoleId) params.set("owner_role_id", filters.ownerRoleId);
    if (filters.parentBudgetId) params.set("parent_budget_id", filters.parentBudgetId);
    if (filters.isPrimary !== undefined) params.set("is_primary", String(filters.isPrimary));
    return request<{ ok: boolean; budgets: Budget[] }>(`/budgets?${params.toString()}`);
  },

  getBudget: (budgetId: string) =>
    request<{
      ok: boolean;
      budget: Budget;
      allowance: BudgetAllowance | null;
      policy: BudgetPolicy | null;
    }>(`/budgets/${encodeURIComponent(budgetId)}`),

  getBudgetTree: (trustId: string) =>
    request<{ ok: boolean; tree: { nodes: Budget[]; edges: [string, string][] } }>(
      `/budgets/tree?trust_id=${encodeURIComponent(trustId)}`,
    ),

  getBudgetAllowance: (budgetId: string) =>
    request<{ ok: boolean; allowance: BudgetAllowance | null }>(
      `/budgets/${encodeURIComponent(budgetId)}/allowance`,
    ),

  getBudgetHistory: (
    budgetId: string,
    opts: { eventType?: string; since?: string; limit?: number } = {},
  ) => {
    const params = new URLSearchParams();
    if (opts.eventType) params.set("event_type", opts.eventType);
    if (opts.since) params.set("since", opts.since);
    if (opts.limit) params.set("limit", String(opts.limit));
    const qs = params.toString() ? `?${params.toString()}` : "";
    return request<{ ok: boolean; events: TreasuryEvent[] }>(
      `/budgets/${encodeURIComponent(budgetId)}/history${qs}`,
    );
  },

  createBudget: (data: {
    trust_id: string;
    owner_role_id: string;
    name: string;
    kind?: BudgetKind;
    parent_budget_id?: string;
    as_role_id?: string;
    idempotency_key?: string;
  }) =>
    request<{ ok: boolean; budget_id?: string; code?: string; error?: string; roles?: string[] }>(
      "/budgets",
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    ),

  setBudgetPolicy: (
    budgetId: string,
    policy: {
      default_inference?: number;
      default_treasury?: number;
      default_suballoc?: number;
      default_hire?: number;
      epoch_period_secs?: number;
      rollover_mode?: "burn" | "rollover";
    },
    opts: { as_role_id?: string; idempotency_key?: string } = {},
  ) =>
    request<{ ok: boolean; code?: string; error?: string; roles?: string[] }>(
      `/budgets/${encodeURIComponent(budgetId)}/policy`,
      {
        method: "POST",
        body: JSON.stringify({ policy, ...opts }),
      },
    ),

  allocateBudget: (
    parentBudgetId: string,
    data: {
      child_budget_id: string;
      bundle: AllowanceBundle;
      as_role_id?: string;
      idempotency_key?: string;
    },
  ) =>
    request<{ ok: boolean; code?: string; error?: string; roles?: string[] }>(
      `/budgets/${encodeURIComponent(parentBudgetId)}/allocate`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    ),

  spendTreasury: (
    budgetId: string,
    data: {
      destination: string;
      amount: number;
      memo?: string;
      as_role_id?: string;
      idempotency_key?: string;
    },
  ) =>
    request<{ ok: boolean; code?: string; error?: string; roles?: string[] }>(
      `/budgets/${encodeURIComponent(budgetId)}/spend`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    ),

  hireFromBudget: (
    parentBudgetId: string,
    data: {
      parent_role_id: string;
      new_role: {
        title: string;
        role_type?: "director" | "operational" | "advisor";
        occupant_kind?: "human" | "agent" | "vacant";
        occupant_id?: string;
        grants?: string[];
      };
      bundle: AllowanceBundle;
      as_role_id?: string;
      idempotency_key?: string;
    },
  ) =>
    request<{
      ok: boolean;
      role_id?: string;
      primary_budget_id?: string;
      code?: string;
      error?: string;
      roles?: string[];
    }>(`/budgets/${encodeURIComponent(parentBudgetId)}/hire`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  refreshBudget: (budgetId: string) =>
    request<{ ok: boolean; allowance: BudgetAllowance | null }>(
      `/budgets/${encodeURIComponent(budgetId)}/refresh`,
      { method: "POST" },
    ),

  dissolveBudget: (budgetId: string, opts: { idempotency_key?: string } = {}) =>
    request<{ ok: boolean; code?: string; error?: string }>(
      `/budgets/${encodeURIComponent(budgetId)}/dissolve`,
      {
        method: "POST",
        body: JSON.stringify(opts),
      },
    ),

  pauseTreasury: (trustId: string, paused: boolean) =>
    request<{ ok: boolean; paused?: boolean; code?: string; error?: string; roles?: string[] }>(
      `/trusts/${encodeURIComponent(trustId)}/treasury/pause`,
      {
        method: "POST",
        body: JSON.stringify({ paused }),
      },
    ),

  initTreasuryConfig: (trustId: string, gateway: string, adminRoleId: string) =>
    request<{ ok: boolean; code?: string; error?: string }>(
      `/trusts/${encodeURIComponent(trustId)}/treasury/config`,
      {
        method: "POST",
        body: JSON.stringify({ inference_gateway: gateway, admin_role_id: adminRoleId }),
      },
    ),
};

// ── Budget primitive types — match the orchestrator's Rust serde shapes
//    in `aeqi-orchestrator/src/budget_registry.rs`.

export type BudgetKind = "primary" | "operating" | "hiring" | "project" | "discretionary";

export interface AllowanceBundle {
  inference_credits: number;
  treasury_cap: number;
  suballoc_cap: number;
  hire_cap: number;
}

export interface Budget {
  id: string;
  trust_id: string;
  parent_budget_id: string | null;
  owner_role_id: string;
  name: string;
  kind: BudgetKind;
  is_primary: boolean;
  created_by_role_id: string | null;
  created_at: string;
}

export interface BudgetAllowance {
  budget_id: string;
  epoch: number;
  caps: AllowanceBundle;
  spent_inference: number;
  spent_treasury: number;
  spent_suballoc: number;
  used_hire: number;
  last_event_at: string;
}

export interface BudgetPolicy {
  budget_id: string;
  defaults: AllowanceBundle;
  epoch_period_secs: number;
  rollover_mode: "burn" | "rollover";
  set_by_role_id: string | null;
  updated_at: string;
}

export interface TreasuryEvent {
  id: number;
  event_type: string;
  budget_id: string;
  acting_role_id: string;
  actor_agent_id: string | null;
  counter_budget_id: string | null;
  epoch: number;
  amount: number | null;
  request_hash: string | null;
  idempotency_key: string | null;
  created_at: string;
}

/// One row of the inbox query — see `crates/aeqi-orchestrator/src/ipc/inbox.rs`.
///
/// 2026-05-07: the inbox returns every session in the user's scope, not
/// just decision-requests. `awaiting_at` is `string` when the session is
/// waiting on a human reply, `null` otherwise — drives the awaiting-dot
/// indicator only, no longer used for filtering. `last_active` is the
/// recency anchor used for sort.
///
/// `agent_name` and `entity_id` are joined server-side; `last_agent_message`
/// is the truncated assistant message body.
export interface InboxItem {
  session_id: string;
  agent_id: string | null;
  agent_name: string | null;
  entity_id: string | null;
  session_name: string;
  awaiting_subject: string | null;
  awaiting_at: string | null;
  last_agent_message: string | null;
  last_active: string;
}

export { ApiError };
