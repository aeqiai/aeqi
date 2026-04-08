// NOTE: HTTPS enforcement should be done at the reverse proxy layer (nginx/caddy),
// not in this client-side code. Ensure your deployment terminates TLS upstream.
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
  const company = localStorage.getItem("aeqi_company");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  if (company && !path.startsWith("/auth/")) {
    headers["X-Company"] = company;
  }

  const res = await fetch(url, { ...options, headers });
  const body = await parseResponseBody(res) as Record<string, unknown> | null;

  if (res.status === 401) {
    // Don't redirect for auth mode check or if mode is "none".
    const authMode = localStorage.getItem("aeqi_auth_mode");
    if (authMode !== "none" && !path.startsWith("/auth/")) {
      localStorage.removeItem("aeqi_token");
      localStorage.removeItem("aeqi_auth_mode");
      localStorage.removeItem("aeqi_pending_email");
      localStorage.removeItem("aeqi_company");
      localStorage.removeItem("aeqi_company_tagline");
      localStorage.removeItem("aeqi_company_avatar");
      window.location.href = "/login";
    }
    throw new ApiError(401, "Unauthorized");
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
    request<{ mode: string; google_oauth: boolean; github_oauth: boolean; waitlist: boolean }>("/auth/mode"),

  login: (secret: string) =>
    request<{ ok: boolean; token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ secret }),
    }),

  loginWithEmail: (email: string, password: string) =>
    request<{ ok: boolean; token: string; user?: Record<string, unknown>; pending_verification?: boolean }>("/auth/login/email", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  signup: (email: string, password: string, name: string, inviteCode?: string) =>
    request<{ ok: boolean; token: string; user?: Record<string, unknown>; pending_verification?: boolean }>("/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password, name, invite_code: inviteCode }),
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

  getInviteCodes: () => request<{ ok: boolean; codes: Array<Record<string, unknown>> }>("/auth/invite/codes"),

  getMe: () => request<Record<string, unknown>>("/auth/me"),

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

  // Dashboard
  getDashboard: () => request<Record<string, unknown>>("/dashboard"),

  // Status
  getStatus: () => request<Record<string, unknown>>("/status"),

  // Worker events
  getWorkerEvents: (params?: { cursor?: number }) => {
    const query = new URLSearchParams();
    if (params?.cursor != null) query.set("cursor", String(params.cursor));
    const qs = query.toString();
    return request<Record<string, unknown>>(`/worker/events${qs ? `?${qs}` : ""}`);
  },

  // Companies
  getCompanies: () => request<Record<string, unknown>>("/companies"),
  createCompany: (data: { name: string; tagline?: string; prefix?: string }) =>
    request<Record<string, unknown>>("/companies", { method: "POST", body: JSON.stringify(data) }),

  // Quests
  getTasks: (params?: { status?: string; company?: string }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (params?.company) query.set("company", params.company);
    const qs = query.toString();
    return request<Record<string, unknown>>(`/quests${qs ? `?${qs}` : ""}`);
  },

  // Missions
  getMissions: (params?: { company?: string }) => {
    const query = new URLSearchParams();
    if (params?.company) query.set("company", params.company);
    const qs = query.toString();
    return request<Record<string, unknown>>(`/missions${qs ? `?${qs}` : ""}`);
  },

  // Agents
  getAgents: () => request<Record<string, unknown>>("/agents/registry"),

  // Audit
  getAudit: (params?: { last?: number; company?: string }) => {
    const query = new URLSearchParams();
    if (params?.last) query.set("last", String(params.last));
    if (params?.company) query.set("company", params.company);
    const qs = query.toString();
    return request<Record<string, unknown>>(`/audit${qs ? `?${qs}` : ""}`);
  },

  // Notes
  getNotes: (params?: { company?: string; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.company) query.set("company", params.company);
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

  // Brief
  getBrief: () => request<Record<string, unknown>>("/brief"),

  // Memories
  getMemories: (params?: { company?: string; query?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.company) q.set("company", params.company);
    if (params?.query) q.set("query", params.query);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<Record<string, unknown>>(`/memories${qs ? `?${qs}` : ""}`);
  },

  // Memory graph & profile
  getMemoryGraph: (params?: { company?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.company) q.set("company", params.company);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<Record<string, unknown>>(`/memory/graph${qs ? `?${qs}` : ""}`);
  },

  getMemoryProfile: (params?: { company?: string }) => {
    const q = new URLSearchParams();
    if (params?.company) q.set("company", params.company);
    const qs = q.toString();
    return request<Record<string, unknown>>(`/memory/profile${qs ? `?${qs}` : ""}`);
  },

  // Skills
  getSkills: () => request<Record<string, unknown>>("/skills"),

  // Pipelines
  getPipelines: () => request<Record<string, unknown>>("/pipelines"),

  // Company Knowledge
  getCompanyKnowledge: (name: string) => request<Record<string, unknown>>(`/companies/${name}/knowledge`),

  // Knowledge CRUD
  storeKnowledge: (data: { company: string; key: string; content: string; category?: string; scope?: string }) =>
    request<{ ok: boolean }>("/knowledge/store", { method: "POST", body: JSON.stringify(data) }),

  deleteKnowledge: (data: { company: string; id: string }) =>
    request<{ ok: boolean }>("/knowledge/delete", { method: "POST", body: JSON.stringify(data) }),

  // Channel Knowledge
  getChannelKnowledge: (params: { company: string; query?: string; limit?: number }) => {
    const q = new URLSearchParams();
    q.set("company", params.company);
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

  // Crons & Watchdogs
  getCrons: () => request<Record<string, unknown>>("/crons"),
  getWatchdogs: () => request<Record<string, unknown>>("/watchdogs"),

  // Health
  getHealth: () => request<{ ok: boolean }>("/health"),

  // Chat -- canonical path
  chatFull: (params: {
    message: string;
    company?: string | null;
    department?: string | null;
    channelName?: string | null;
    chatId?: number;
    sender?: string;
  }) =>
    request<Record<string, unknown>>("/chat/full", {
      method: "POST",
      body: JSON.stringify({
        message: params.message,
        ...(params.company ? { company: params.company } : {}),
        ...(params.department ? { department: params.department } : {}),
        ...(params.channelName ? { channel_name: params.channelName } : {}),
        ...(params.chatId ? { chat_id: params.chatId } : {}),
        ...(params.sender ? { sender: params.sender } : {}),
      }),
    }),

  // Chat -- typed thread timeline
  chatTimeline: (params?: {
    chatId?: number;
    company?: string | null;
    department?: string | null;
    channelName?: string | null;
    limit?: number;
  }) => {
    const query = new URLSearchParams();
    if (params?.chatId) query.set("chat_id", String(params.chatId));
    if (params?.company) query.set("company", params.company);
    if (params?.department) query.set("department", params.department);
    if (params?.channelName) query.set("channel_name", params.channelName);
    if (params?.limit) query.set("limit", String(params.limit));
    const qs = query.toString();
    return request<Record<string, unknown>>(`/chat/timeline${qs ? `?${qs}` : ""}`);
  },

  // Write: Create Quest
  createQuest: (data: {
    company: string;
    subject: string;
    description?: string;
    priority?: string;
    acceptance_criteria?: string;
    assignee?: string;
  }) =>
    request<Record<string, unknown>>("/quests", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Write: Close Quest
  closeQuest: (id: string, data?: { reason?: string; company?: string }) =>
    request<{ ok: boolean }>(`/quests/${id}/close`, {
      method: "POST",
      body: JSON.stringify(data || {}),
    }),

  // Write: Post Note
  postNote: (data: { company: string; key: string; content: string; tags?: string[]; durability?: string }) =>
    request<{ ok: boolean }>("/notes", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Single quest
  getQuest: (id: string) => request<Record<string, unknown>>(`/quests/${id}`),

  // Audit filtered by quest (client-side filter)
  getAuditForQuest: async (taskId: string, last = 50) => {
    const data = await request<Record<string, unknown>>(`/audit?last=${last}`);
    const raw = (data.entries || data.audit || []) as Array<Record<string, unknown>>;
    const entries = raw.filter((e) => e.task_id === taskId);
    return { entries };
  },

  // Sessions
  getSessions: (agentId?: string) => {
    const q = new URLSearchParams();
    if (agentId) q.set("agent_id", agentId);
    const qs = q.toString();
    return request<Record<string, unknown>>(`/sessions${qs ? `?${qs}` : ""}`);
  },
  createSession: (agentId: string) =>
    request<Record<string, unknown>>("/sessions", { method: "POST", body: JSON.stringify({ agent_id: agentId }) }),

  // Spawn Agent
  spawnAgent: (data: { template: string; project?: string; parent_id?: string }) =>
    request<{ agent_id: string }>("/agents/spawn", { method: "POST", body: JSON.stringify(data) }),

  // Create Prompt
  createPrompt: (data: { project: string; name: string; content: string }) =>
    request<{ ok: boolean }>("/prompts", { method: "POST", body: JSON.stringify(data) }),
  closeSession: (sessionId: string) =>
    request<{ ok: boolean }>(`/sessions/${sessionId}/close`, { method: "POST" }),

  // Session children (spawned work)
  getSessionChildren: (sessionId: string) =>
    request<Record<string, unknown>>(`/sessions/${sessionId}/children`),

  // Session messages
  getSessionMessages: (params: { session_id?: string; channel_name?: string; agent_id?: string; limit?: number }) => {
    // Prefer new session-based endpoint when a UUID session_id is available.
    if (params.session_id) {
      const limit = params.limit || 50;
      return request<Record<string, unknown>>(`/sessions/${params.session_id}/messages?limit=${limit}`);
    }
    // Fallback to deprecated endpoint for backwards compat.
    const query = new URLSearchParams();
    if (params.channel_name) query.set("channel_name", params.channel_name);
    if (params.agent_id) query.set("agent_id", params.agent_id);
    if (params.limit) query.set("limit", String(params.limit));
    const qs = query.toString();
    return request<Record<string, unknown>>(`/chat/history${qs ? `?${qs}` : ""}`);
  },

  // Context panel (per-channel)
  getNote: (channel: string) => request<Record<string, unknown>>(`/notes/${encodeURIComponent(channel)}`),
  saveNote: (data: { channel: string; content: string }) =>
    request<{ ok: boolean }>("/notes", { method: "POST", body: JSON.stringify(data) }),
  deleteNote: (id: string) =>
    request<{ ok: boolean }>(`/notes/${id}/delete`, { method: "DELETE" }),
  updateDirectiveStatus: (id: string, data: { status: string; task_id?: string }) =>
    request<{ ok: boolean }>(`/directives/${id}/status`, { method: "POST", body: JSON.stringify(data) }),

  // Triggers
  getTriggers: () => request<Record<string, unknown>>("/triggers"),

};

export { ApiError };
