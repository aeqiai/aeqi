import { clearSessionData } from "@/lib/session";
import { getScopedRoot, type AppMode } from "@/lib/appMode";
import type { EventInvocationRow, InvocationStepRow } from "@/lib/types";
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
  getRoots: () => request<Record<string, unknown>>("/roots"),
  createRoot: (data: { name: string; tagline?: string; prefix?: string }) =>
    request<Record<string, unknown>>("/roots", { method: "POST", body: JSON.stringify(data) }),
  updateRoot: (
    name: string,
    data: { display_name?: string; tagline?: string; logo_url?: string },
  ) =>
    request<{ ok: boolean }>(`/roots/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  // Quests
  getQuests: (params?: { status?: string; root?: string }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (params?.root) query.set("root", params.root);
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
    if (params?.root) query.set("root", params.root);
    const qs = query.toString();
    return request<Record<string, unknown>>(`/activity${qs ? `?${qs}` : ""}`);
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
  getIdeas: (params?: { root?: string; query?: string; limit?: number; agent_id?: string }) => {
    const q = new URLSearchParams();
    if (params?.root) q.set("root", params.root);
    if (params?.query) q.set("query", params.query);
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.agent_id) q.set("agent_id", params.agent_id);
    const qs = q.toString();
    return request<Record<string, unknown>>(`/ideas${qs ? `?${qs}` : ""}`);
  },

  // Skills (ideas tagged with "skill")
  getSkills: () => request<Record<string, unknown>>("/ideas/search?tags=skill"),

  // Identity templates (ideas tagged with "identity") — drives the CreateAgent picker.
  getIdentityTemplates: () => request<Record<string, unknown>>("/ideas/search?tags=identity"),

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
  // does not touch the config blob.
  setChannelAllowedChats: (id: string, chatIds: string[]) =>
    request<Record<string, unknown>>(`/channels/${encodeURIComponent(id)}/allowed-chats`, {
      method: "PATCH",
      body: JSON.stringify({ chat_ids: chatIds }),
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

  // Idea graph & profile
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
    links?: string[];
  }) =>
    request<{ ok: boolean; id: string }>("/ideas", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  deleteIdea: (id: string) =>
    request<{ ok: boolean }>(`/ideas/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

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

  // Agent Identity
  getAgentIdentity: (name: string) => request<Record<string, unknown>>(`/agents/${name}/identity`),
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
    project: string;
    subject: string;
    description?: string;
    priority?: string;
    acceptance_criteria?: string;
    agent_id?: string;
    agent?: string;
  }) =>
    request<Record<string, unknown>>("/quests", {
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

  // Write: Update Quest (description, status, priority, labels, agent_id)
  updateQuest: (
    id: string,
    data: {
      description?: string;
      status?: string;
      priority?: string;
      labels?: string[];
      agent_id?: string;
    },
  ) =>
    request<{ ok: boolean }>(`/quests/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  // Write: Close Quest
  closeQuest: (id: string, data?: { reason?: string; root?: string }) =>
    request<{ ok: boolean }>(`/quests/${id}/close`, {
      method: "POST",
      body: JSON.stringify(data ? { reason: data.reason, root: data.root } : {}),
    }),

  // Read: Quest preflight — assemble the system prompt without creating anything
  questPreflight: (data: { agent_id: string; description: string; task_idea_ids?: string[] }) =>
    request<{ ok: boolean; system: string; tools: { allow: string[]; deny: string[] } }>(
      "/quests/preflight",
      { method: "POST", body: JSON.stringify(data) },
    ),

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

  // Event invocation trace
  listInvocations: (sessionId: string, limit = 50) =>
    request<{
      ok: boolean;
      invocations: EventInvocationRow[];
    }>(`/events/trace?session_id=${encodeURIComponent(sessionId)}&limit=${limit}`),
  getInvocationDetail: (invocationId: number) =>
    request<{
      ok: boolean;
      invocation: EventInvocationRow;
      steps: InvocationStepRow[];
    }>("/events/trace", {
      method: "POST",
      body: JSON.stringify({ invocation_id: invocationId }),
    }),

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

  driveDownloadUrl: (fid: string) => `${BASE_URL}/drive/${encodeURIComponent(fid)}`,

  deleteDriveFile: (fid: string) =>
    request<{ ok: boolean; deleted?: boolean }>(`/drive/${encodeURIComponent(fid)}`, {
      method: "DELETE",
    }),
};

export { ApiError };
