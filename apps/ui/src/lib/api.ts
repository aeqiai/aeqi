import { clearSessionData } from "@/lib/session";
import { getScopedRoot, type AppMode } from "@/lib/appMode";
const BASE_URL = import.meta.env.VITE_API_URL || "/api";

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function getToken(): string | null {
  return localStorage.getItem("aeqi_token");
}

async function parseResponseBody(res: Response): Promise<unknown> {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return null;
  }

  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const root = getScopedRoot();
  if (root && !path.startsWith("/auth/")) {
    headers["X-Root"] = root;
  }

  const res = await fetch(url, { ...options, headers });
  const body = (await parseResponseBody(res)) as Record<string, unknown> | null;

  if (res.status === 401) {
    // Don't redirect for auth mode check or if mode is "none".
    const authMode = localStorage.getItem("aeqi_auth_mode");
    if (authMode !== "none" && !path.startsWith("/auth/")) {
      clearSessionData();
      localStorage.removeItem("aeqi_auth_mode");
      window.location.href = "/login";
    }
    throw new ApiError(401, "Unauthorized");
  }

  if (res.status === 403 && !path.startsWith("/auth/")) {
    localStorage.removeItem("aeqi_root");
    localStorage.removeItem("aeqi_root_tagline");
    localStorage.removeItem("aeqi_root_avatar");
  }

  if (!res.ok) {
    const message =
      (typeof body?.error === "string" ? body.error : null) ||
      (typeof body?.message === "string" ? body.message : null) ||
      `API error: ${res.statusText}`;
    throw new ApiError(res.status, message);
  }

  return body as T;
}

export const api = {
  // Auth
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

  signup: (email: string, password: string, name: string, inviteCode?: string, template?: string) =>
    request<{
      ok: boolean;
      token: string;
      user?: Record<string, unknown>;
      pending_verification?: boolean;
    }>("/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password, name, invite_code: inviteCode, template }),
    }),

  joinWaitlist: (email: string) =>
    request<{ ok: boolean; message: string }>("/auth/waitlist", {
      method: "POST",
      body: JSON.stringify({ email }),
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

  // Dashboard
  getDashboard: () => request<Record<string, unknown>>("/dashboard"),

  // Status
  getStatus: () => request<Record<string, unknown>>("/status"),

  // Activity events
  getActivityEvents: (params?: { cursor?: number }) => {
    const query = new URLSearchParams();
    if (params?.cursor != null) query.set("cursor", String(params.cursor));
    const qs = query.toString();
    return request<Record<string, unknown>>(`/activity/events${qs ? `?${qs}` : ""}`);
  },

  // Roots (root agents)
  getRoots: () => request<Record<string, unknown>>("/companies"),
  createRoot: (data: { name: string; tagline?: string; prefix?: string }) =>
    request<Record<string, unknown>>("/companies", { method: "POST", body: JSON.stringify(data) }),
  updateRoot: (
    name: string,
    data: { display_name?: string; tagline?: string; logo_url?: string },
  ) =>
    request<{ ok: boolean }>(`/companies/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  // Quests
  getQuests: (params?: { status?: string; root?: string }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (params?.root) query.set("company", params.root);
    const qs = query.toString();
    return request<Record<string, unknown>>(`/quests${qs ? `?${qs}` : ""}`);
  },

  // Agents
  getAgents: (params?: { root?: boolean }) =>
    request<Record<string, unknown>>(params?.root ? "/agents?root=true" : "/agents"),

  // Activity stream (daemon events)
  getActivityStream: (params?: { last?: number; root?: string }) => {
    const query = new URLSearchParams();
    if (params?.last) query.set("last", String(params.last));
    if (params?.root) query.set("company", params.root);
    const qs = query.toString();
    return request<Record<string, unknown>>(`/activity${qs ? `?${qs}` : ""}`);
  },

  // Notes
  getNotes: (params?: { root?: string; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.root) query.set("company", params.root);
    if (params?.limit) query.set("limit", String(params.limit));
    const qs = query.toString();
    return request<Record<string, unknown>>(`/notes${qs ? `?${qs}` : ""}`);
  },

  // Expertise
  getExpertise: (domain?: string) => {
    const query = new URLSearchParams();
    if (domain) query.set("domain", domain);
    const qs = query.toString();
    return request<Record<string, unknown>>(`/expertise${qs ? `?${qs}` : ""}`);
  },

  // Cost
  getCost: () => request<Record<string, unknown>>("/cost"),

  // Ideas
  getIdeas: (params?: { root?: string; query?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.root) q.set("company", params.root);
    if (params?.query) q.set("query", params.query);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<Record<string, unknown>>(`/ideas${qs ? `?${qs}` : ""}`);
  },

  // Skills (ideas tagged with "skill")
  getSkills: () => request<Record<string, unknown>>("/ideas/search?tags=skill"),

  // Agent Channels (stored as ideas with key prefix "channel:")
  getAgentChannels: (agentId: string) =>
    request<Record<string, unknown>>(`/ideas?agent_id=${encodeURIComponent(agentId)}`),
  createAgentChannel: (params: {
    agent_id: string;
    channel_type: string;
    config: Record<string, string>;
  }) =>
    request<Record<string, unknown>>("/ideas", {
      method: "POST",
      body: JSON.stringify({
        key: `channel:${params.channel_type}`,
        content: JSON.stringify(params.config),
        tags: ["fact"],
        agent_id: params.agent_id,
      }),
    }),
  deleteAgentChannel: (id: string) =>
    request<Record<string, unknown>>(`/ideas/${id}`, { method: "DELETE" }),
  getChannelSessions: (agentId: string) =>
    request<Record<string, unknown>>(`/channel-sessions?agent_id=${encodeURIComponent(agentId)}`),
  updateIdea: (id: string, body: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/ideas/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  // Idea graph & profile
  getIdeaGraph: (params?: { root?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.root) q.set("company", params.root);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<Record<string, unknown>>(`/ideas/graph${qs ? `?${qs}` : ""}`);
  },

  getIdeaProfile: (params?: { root?: string }) => {
    const q = new URLSearchParams();
    if (params?.root) q.set("company", params.root);
    const qs = q.toString();
    return request<Record<string, unknown>>(`/ideas/profile${qs ? `?${qs}` : ""}`);
  },

  // Root Agent Knowledge
  getRootKnowledge: (name: string) =>
    request<Record<string, unknown>>(`/companies/${name}/knowledge`),

  // Knowledge CRUD
  storeKnowledge: (data: {
    root: string;
    name: string;
    content: string;
    tags?: string[];
    scope?: string;
  }) =>
    request<{ ok: boolean }>("/knowledge/store", {
      method: "POST",
      body: JSON.stringify({ ...data, company: data.root, root: undefined }),
    }),

  deleteKnowledge: (data: { root: string; id: string }) =>
    request<{ ok: boolean }>("/knowledge/delete", {
      method: "POST",
      body: JSON.stringify({ company: data.root, id: data.id }),
    }),

  // Channel Knowledge
  getChannelKnowledge: (params: { root: string; query?: string; limit?: number }) => {
    const q = new URLSearchParams();
    q.set("company", params.root);
    if (params.query) q.set("query", params.query);
    if (params.limit) q.set("limit", String(params.limit));
    return request<Record<string, unknown>>(`/knowledge/channel?${q.toString()}`);
  },

  // Agent Identity
  getAgentIdentity: (name: string) => request<Record<string, unknown>>(`/agents/${name}/identity`),
  getAgentPrompts: (name: string) => request<Record<string, unknown>>(`/agents/${name}/prompts`),
  saveAgentFile: (name: string, filename: string, content: string) =>
    request<{ ok: boolean }>(`/agents/${name}/files`, {
      method: "POST",
      body: JSON.stringify({ filename, content }),
    }),

  // Rate Limit
  getRateLimit: () => request<Record<string, unknown>>("/rate-limit"),

  // Health
  getHealth: () => request<{ ok: boolean }>("/health"),

  // Write: Create Quest
  createQuest: (data: {
    root: string;
    subject: string;
    description?: string;
    priority?: string;
    acceptance_criteria?: string;
    assignee?: string;
  }) =>
    request<Record<string, unknown>>("/quests", {
      method: "POST",
      body: JSON.stringify({ ...data, company: data.root, root: undefined }),
    }),

  // Write: Close Quest
  closeQuest: (id: string, data?: { reason?: string; root?: string }) =>
    request<{ ok: boolean }>(`/quests/${id}/close`, {
      method: "POST",
      body: JSON.stringify(data ? { reason: data.reason, company: data.root } : {}),
    }),

  // Write: Post Note
  postNote: (data: {
    root: string;
    name: string;
    content: string;
    tags?: string[];
    durability?: string;
  }) =>
    request<{ ok: boolean }>("/notes", {
      method: "POST",
      body: JSON.stringify({ ...data, company: data.root, root: undefined }),
    }),

  // Single quest
  getQuest: (id: string) => request<Record<string, unknown>>(`/quests/${id}`),

  // Sessions
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

  // Spawn Agent
  spawnAgent: (data: {
    template: string;
    project?: string;
    parent_id?: string;
    display_name?: string;
    system_prompt?: string;
  }) =>
    request<{ agent_id: string }>("/agents/spawn", { method: "POST", body: JSON.stringify(data) }),

  closeSession: (sessionId: string) =>
    request<{ ok: boolean }>(`/sessions/${sessionId}/close`, { method: "POST" }),
  cancelSession: (sessionId: string) =>
    request<{ ok: boolean; cancelled: boolean }>(`/sessions/${sessionId}/cancel`, {
      method: "POST",
    }),
  forkSession: (sessionId: string, messageId: number) =>
    request<{ ok: boolean; session_id: string }>(`/sessions/${sessionId}/fork`, {
      method: "POST",
      body: JSON.stringify({ message_id: messageId }),
    }),

  // Agent model
  setAgentModel: (agentId: string, model: string) =>
    request<{ ok: boolean }>(`/agents/${agentId}/model`, {
      method: "PUT",
      body: JSON.stringify({ model }),
    }),

  setAgentTools: (agentId: string, toolDeny: string[]) =>
    request<{ ok: boolean }>(`/agents/${agentId}/tools`, {
      method: "PUT",
      body: JSON.stringify({ tool_deny: toolDeny }),
    }),

  // Ideas by IDs
  getIdeasByIds: (ids: string[]) =>
    request<{
      ok: boolean;
      ideas: Array<{ id: string; name: string; content: string; tags: string[] }>;
    }>("/ideas/by-ids", { method: "POST", body: JSON.stringify({ ids }) }),

  // Agent events
  getAgentEvents: (agentId: string) =>
    request<Record<string, unknown>>(`/events?agent_id=${encodeURIComponent(agentId)}`),
  createEvent: (data: Record<string, unknown>) =>
    request<Record<string, unknown>>("/events", { method: "POST", body: JSON.stringify(data) }),
  updateEvent: (id: string, data: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/events/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteEvent: (id: string) =>
    request<Record<string, unknown>>(`/events/${id}`, { method: "DELETE" }),

  // Session children (spawned work)
  getSessionChildren: (sessionId: string) =>
    request<Record<string, unknown>>(`/sessions/${sessionId}/children`),

  // Session messages
  getSessionMessages: (sessionId: string, limit = 50) =>
    request<Record<string, unknown>>(`/sessions/${sessionId}/messages?limit=${limit}`),

  // Account API key (ak_)
  generateApiKey: () =>
    request<{ ok: boolean; id: string; api_key: string; rotated: boolean }>("/account/api-key", {
      method: "POST",
    }),

  // Secret Keys (sk_)
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
      body: JSON.stringify({ company: data.root, name: data.name }),
    }),

  revokeKey: (id: string) => request<{ ok: boolean }>(`/keys/${id}`, { method: "DELETE" }),
};

export { ApiError };
