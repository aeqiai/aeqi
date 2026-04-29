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
