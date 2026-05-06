export const ideaKeys = {
  all: ["ideas"] as const,
  byAgent: (agentId: string) => ["ideas", "agent", agentId] as const,
  graph: (agentId?: string) => ["ideas", "graph", agentId ?? "global"] as const,
};

export const eventKeys = {
  all: ["events"] as const,
  byAgent: (agentId: string) => ["events", "agent", agentId] as const,
};

export const channelKeys = {
  all: ["channels"] as const,
  byAgent: (agentId: string) => ["channels", "agent", agentId] as const,
  sessions: (agentId: string) => ["channels", "sessions", agentId] as const,
};

/**
 * Query keys for in-app, Slack-style conversation channels —
 * `session_type='channel'` sessions bound to a Company entity.
 * Distinct from `channelKeys` (transport channels: Telegram / WhatsApp / Slack-app).
 */
export const conversationChannelKeys = {
  all: ["conversation-channels"] as const,
  byEntity: (entityId: string) => ["conversation-channels", "entity", entityId] as const,
  messages: (sessionId: string) => ["conversation-channels", "messages", sessionId] as const,
  participants: (sessionId: string) =>
    ["conversation-channels", "participants", sessionId] as const,
};

export const entityKeys = {
  all: ["entities"] as const,
};

export const agentKeys = {
  all: ["agents"] as const,
  directory: ["agents", "directory"] as const,
};

export const questKeys = {
  all: ["quests"] as const,
  list: (params?: { status?: string; root?: string }) =>
    ["quests", "list", params?.status ?? "all", params?.root ?? "global"] as const,
};

export const activityKeys = {
  all: ["activity"] as const,
  stream: (params?: { last?: number; root?: string }) =>
    ["activity", "stream", params?.last ?? "all", params?.root ?? "global"] as const,
};

export const runtimeKeys = {
  all: ["runtime"] as const,
  status: ["runtime", "status"] as const,
  dashboard: ["runtime", "dashboard"] as const,
  cost: ["runtime", "cost"] as const,
};
