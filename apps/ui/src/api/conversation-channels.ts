/**
 * In-app, Slack-style channels API.
 *
 * Distinct from `src/api/channels.ts`, which manages transport channels
 * (Telegram / WhatsApp / Slack-app webhook bindings). These are
 * `session_type='channel'` sessions bound to a Company entity, where
 * humans + agents talk together.
 *
 * Wire shapes match the Rust IPC handlers in
 * `crates/aeqi-orchestrator/src/ipc/sessions.rs`:
 *
 *   GET  /entities/:entityId/channels       → list_channels_for_entity
 *   POST /entities/:entityId/channels       → create_channel
 *   GET  /sessions/:id/messages             → session_messages
 *   GET  /sessions/:id/participants         → session_participants
 *   POST /sessions/:id/participants         → add_participant
 *   POST /messages/to                       → message_to (target=session)
 */

import { apiRequest } from "@/api/client";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ChannelListItem {
  session_id: string;
  name: string;
  created_at: string;
  participant_count: number;
  last_message_at: string | null;
  last_message_preview: string | null;
}

export interface ChannelParticipant {
  session_id: string;
  identity_kind: "user" | "agent" | "position" | "external" | string;
  identity_id: string;
  joined_at: string;
  joined_by: string | null;
}

export interface ChannelSender {
  id: string;
  display_name: string;
  transport: string;
  avatar_url: string | null;
}

export interface ChannelMessage {
  id: number;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
  source: string | null;
  event_type: string | null;
  transport: string | null;
  sender?: ChannelSender;
  metadata?: Record<string, unknown>;
}

// ─── Wire shapes ────────────────────────────────────────────────────────────

interface ListChannelsResponse {
  ok: boolean;
  channels?: ChannelListItem[];
  error?: string;
}

interface CreateChannelResponse {
  ok: boolean;
  session_id?: string;
  name?: string;
  error?: string;
}

interface MessagesResponse {
  ok: boolean;
  messages?: ChannelMessage[];
  error?: string;
}

interface ParticipantsResponse {
  ok: boolean;
  participants?: ChannelParticipant[];
  error?: string;
}

interface MessageToResponse {
  ok: boolean;
  session_id?: string;
  message_id?: number;
  error?: string;
}

// ─── API functions ──────────────────────────────────────────────────────────

export async function listChannelsForEntity(entityId: string): Promise<ChannelListItem[]> {
  const res = await apiRequest<ListChannelsResponse>(
    `/entities/${encodeURIComponent(entityId)}/channels`,
  );
  if (!res.ok) throw new Error(res.error ?? "failed to list channels");
  return res.channels ?? [];
}

export interface InitialParticipant {
  kind: "user" | "agent" | "position";
  id: string;
}

export async function createChannel(params: {
  entityId: string;
  name: string;
  participants?: InitialParticipant[];
}): Promise<{ session_id: string; name: string }> {
  const res = await apiRequest<CreateChannelResponse>(
    `/entities/${encodeURIComponent(params.entityId)}/channels`,
    {
      method: "POST",
      body: JSON.stringify({
        name: params.name,
        participants: params.participants ?? [],
      }),
    },
  );
  if (!res.ok || !res.session_id) {
    throw new Error(res.error ?? "failed to create channel");
  }
  return { session_id: res.session_id, name: res.name ?? params.name };
}

export async function getChannelMessages(
  sessionId: string,
  limit = 100,
): Promise<ChannelMessage[]> {
  const res = await apiRequest<MessagesResponse>(
    `/sessions/${encodeURIComponent(sessionId)}/messages?limit=${limit}`,
  );
  if (!res.ok) throw new Error(res.error ?? "failed to load messages");
  return res.messages ?? [];
}

export async function getChannelParticipants(sessionId: string): Promise<ChannelParticipant[]> {
  const res = await apiRequest<ParticipantsResponse>(
    `/sessions/${encodeURIComponent(sessionId)}/participants`,
  );
  if (!res.ok) throw new Error(res.error ?? "failed to load participants");
  return res.participants ?? [];
}

export async function addChannelParticipant(params: {
  sessionId: string;
  kind: "user" | "agent" | "position" | "external";
  id: string;
}): Promise<void> {
  const res = await apiRequest<{ ok: boolean; error?: string }>(
    `/sessions/${encodeURIComponent(params.sessionId)}/participants`,
    {
      method: "POST",
      body: JSON.stringify({ identity_kind: params.kind, identity_id: params.id }),
    },
  );
  if (!res.ok) throw new Error(res.error ?? "failed to add participant");
}

export async function postChannelMessage(params: {
  sessionId: string;
  body: string;
  fromKind: "user" | "agent";
  fromId: string;
}): Promise<{ message_id: number | null }> {
  const res = await apiRequest<MessageToResponse>("/messages/to", {
    method: "POST",
    body: JSON.stringify({
      target_kind: "session",
      target_id: params.sessionId,
      body: params.body,
      from_kind: params.fromKind,
      from_id: params.fromId,
    }),
  });
  if (!res.ok) throw new Error(res.error ?? "failed to send message");
  return { message_id: res.message_id ?? null };
}
