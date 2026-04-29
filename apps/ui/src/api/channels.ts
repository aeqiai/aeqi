import { apiRequest } from "@/api/client";

/**
 * One entry in a channel's whitelist. `reply_allowed=false` is read-only:
 * the agent receives the message but its auto-reply pipeline is suppressed.
 */
export interface AllowedChat {
  chat_id: string;
  reply_allowed: boolean;
}

export interface ChannelEntry {
  id: string;
  agent_id: string;
  kind: string;
  config: Record<string, unknown>;
  enabled: boolean;
  allowed_chats: AllowedChat[];
}

export interface AgentChannelsResponse {
  channels: ChannelEntry[];
}

export interface ChannelSession {
  channel_key: string;
  session_id: string;
  chat_id: string;
  transport: string;
  created_at: string;
}

export function normalizeAllowedChats(value: unknown): AllowedChat[] {
  const allowed = Array.isArray(value) ? value : [];
  return allowed
    .map((v): AllowedChat | null => {
      if (typeof v === "string") {
        return { chat_id: v, reply_allowed: true };
      }
      if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        const chat_id = o.chat_id;
        if (typeof chat_id !== "string") return null;
        return {
          chat_id,
          reply_allowed: o.reply_allowed === false ? false : true,
        };
      }
      return null;
    })
    .filter((v): v is AllowedChat => v !== null);
}

export function normalizeChannel(row: Record<string, unknown>): ChannelEntry {
  const config = (row.config as Record<string, unknown>) || {};
  const kind = (row.kind as string) || (config.kind as string) || "unknown";
  return {
    id: row.id as string,
    agent_id: row.agent_id as string,
    kind,
    config,
    enabled: (row.enabled as boolean) ?? true,
    allowed_chats: normalizeAllowedChats(row.allowed_chats),
  };
}

export async function listAgentChannels(agentId: string): Promise<AgentChannelsResponse> {
  const data = await apiRequest<{ channels?: unknown[] }>(
    `/agents/${encodeURIComponent(agentId)}/channels`,
  );
  const rows = Array.isArray(data.channels) ? data.channels : [];
  return {
    channels: rows
      .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
      .map(normalizeChannel),
  };
}

export function createAgentChannel(params: {
  agent_id: string;
  config: Record<string, unknown> & { kind: string };
}): Promise<Record<string, unknown>> {
  return apiRequest<Record<string, unknown>>(
    `/agents/${encodeURIComponent(params.agent_id)}/channels`,
    {
      method: "POST",
      body: JSON.stringify({ config: params.config }),
    },
  );
}

export function deleteAgentChannel(id: string): Promise<Record<string, unknown>> {
  return apiRequest<Record<string, unknown>>(`/channels/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function setChannelAllowedChats(
  id: string,
  chats: AllowedChat[],
): Promise<Record<string, unknown>> {
  return apiRequest<Record<string, unknown>>(`/channels/${encodeURIComponent(id)}/allowed-chats`, {
    method: "PATCH",
    body: JSON.stringify({ chat_ids: chats }),
  });
}

export function listChannelSessions(agentId: string): Promise<{ sessions: ChannelSession[] }> {
  return apiRequest<{ sessions: ChannelSession[] }>(
    `/channel-sessions?agent_id=${encodeURIComponent(agentId)}`,
  );
}
