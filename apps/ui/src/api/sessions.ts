/**
 * Session-layer API calls for the Idea conversation panel.
 *
 * The wire shapes match the Rust IPC handlers in
 * `crates/aeqi-orchestrator/src/ipc/ideas.rs`:
 *
 *   GET /ideas/:id/comments → { ok, session_id, subscribed, items: [...] }
 *   GET /ideas/:id/activity → { ok, items: [...] }
 *
 * Field-name mapping from the wire to the UI types lives in this file —
 * components consume the mapped shapes (`timestamp / author / author_kind`)
 * and never see the raw `at / from_id / from_kind`.
 *
 * getIdeaActivity   — activity_log rows + system session_messages for idea
 * getIdeaComments   — non-system session_messages for idea.session_id
 * messageTo         — IPC `message_to` (target = {kind:"idea", id})
 * addSessionParticipant — POST /sessions/:id/participants (subscribe)
 */

import { apiRequest } from "@/api/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ActivityRow {
  id: string | number;
  kind: "activity";
  /** ISO-8601 */
  timestamp: string;
  /** Human-readable summary or event name */
  summary: string;
  /** Structured metadata from the activity_log row */
  metadata?: Record<string, unknown>;
  /** decision_type from activity_log */
  event_type?: string;
}

export interface CommentRow {
  id: string | number;
  kind: "comment";
  /** ISO-8601 */
  timestamp: string;
  /** Sender display name (resolved on the backend) */
  author: string;
  /** Raw `from_id` (UUID). Reserved for system mention/lookup; the bubble's
   * hue + initials key off `author` so the avatar matches the rest of the app. */
  author_id?: string;
  /** Author kind: user / agent / role / system */
  author_kind: "user" | "agent" | "role" | "system" | string;
  /** Message body */
  body: string;
  /** Optimistic flag — true while the write is in-flight */
  pending?: boolean;
  /** Stable identifier for dedup / replace after optimistic resolution */
  temp_id?: string;
}

/** Wire shape from GET /ideas/:id/activity */
interface ActivityResponse {
  ok: boolean;
  items?: Array<{
    kind: "log" | "system_message";
    at: string;
    body?: string;
    payload?: Record<string, unknown> | string;
  }>;
}

/** Wire shape from GET /ideas/:id/comments */
interface CommentsResponse {
  ok: boolean;
  session_id: string | null;
  subscribed: boolean;
  items?: Array<{
    id: string | number;
    from_kind: string;
    from_id: string | null;
    /** Backend-resolved display name (agent.name / role.title / "User <prefix>"). */
    author?: string;
    body: string;
    at: string;
  }>;
}

export interface CommentsPayload {
  rows: CommentRow[];
  sessionId: string | null;
  subscribed: boolean;
}

export type MessageToError = { kind: "unknown_command" | "api_error"; message: string };
export type MessageToResult = { ok: true } | { ok: false; error: MessageToError };

// ─── Internals ────────────────────────────────────────────────────────────────

function isUnknownCommandLike(msg: string): boolean {
  return (
    msg.includes("404") ||
    msg.includes("unknown_command") ||
    msg.includes("not found") ||
    msg.includes("Not Found")
  );
}

// ─── API functions ─────────────────────────────────────────────────────────────

export async function getIdeaActivity(ideaId: string): Promise<ActivityRow[]> {
  try {
    const res = await apiRequest<ActivityResponse>(`/ideas/${encodeURIComponent(ideaId)}/activity`);
    const items = res.items ?? [];
    return items.map((item, idx): ActivityRow => {
      const summary =
        item.kind === "system_message"
          ? (item.body ?? "")
          : item.payload !== undefined
            ? typeof item.payload === "string"
              ? item.payload
              : JSON.stringify(item.payload)
            : "";
      return {
        id: `${item.kind}-${idx}-${item.at}`,
        kind: "activity",
        timestamp: item.at,
        summary,
        event_type: item.kind === "log" ? "activity" : undefined,
      };
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isUnknownCommandLike(msg)) {
      console.warn("[sessions] getIdeaActivity: endpoint not yet available, returning empty");
      return [];
    }
    throw err;
  }
}

export async function getIdeaComments(ideaId: string): Promise<CommentsPayload> {
  try {
    const res = await apiRequest<CommentsResponse>(`/ideas/${encodeURIComponent(ideaId)}/comments`);
    const items = res.items ?? [];
    const rows: CommentRow[] = items.map((item) => ({
      id: item.id,
      kind: "comment",
      timestamp: item.at,
      // Backend resolves agent.name / role.title / "User <prefix>" so avatar
      // hue + initials match the rest of the app. Coalesce on the way down
      // for legacy / pre-migration rows that still lack `author`.
      author: item.author ?? item.from_id ?? item.from_kind ?? "unknown",
      author_id: item.from_id ?? undefined,
      author_kind: item.from_kind ?? "unknown",
      body: item.body ?? "",
    }));
    return {
      rows,
      sessionId: res.session_id ?? null,
      subscribed: Boolean(res.subscribed),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isUnknownCommandLike(msg)) {
      console.warn("[sessions] getIdeaComments: endpoint not yet available, returning empty");
      return { rows: [], sessionId: null, subscribed: false };
    }
    throw err;
  }
}

export async function messageTo(params: {
  target: { kind: "idea"; id: string };
  body: string;
  kind?: string;
}): Promise<MessageToResult> {
  try {
    await apiRequest<{ ok: boolean }>("/messages/to", {
      method: "POST",
      body: JSON.stringify(params),
    });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isUnknownCommandLike(msg)) {
      return {
        ok: false,
        error: { kind: "unknown_command", message: "message_to IPC not yet available" },
      };
    }
    return { ok: false, error: { kind: "api_error", message: msg } };
  }
}

/** Subscribe an identity to a session's participant roster. */
export async function addSessionParticipant(params: {
  sessionId: string;
  kind: "user" | "agent" | "position" | "external";
  id: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiRequest<{ ok: boolean; error?: string }>(
      `/sessions/${encodeURIComponent(params.sessionId)}/participants`,
      {
        method: "POST",
        body: JSON.stringify({ identity_kind: params.kind, identity_id: params.id }),
      },
    );
    return { ok: Boolean(res?.ok), error: res?.error };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Subscribe the calling user to an idea's conversation.
 *
 * Lazy-creates the idea's backing session if one doesn't exist yet and adds
 * the caller as a `user`-kind participant. The caller identity is resolved
 * from the request's JWT scope on the backend — no body needed.
 *
 * Returns the canonical session id so the panel can store it locally for
 * subsequent operations (composer, polling).
 */
export async function subscribeToIdea(
  ideaId: string,
): Promise<{ ok: boolean; sessionId?: string; subscribed?: boolean; error?: string }> {
  try {
    const res = await apiRequest<{
      ok: boolean;
      session_id?: string;
      subscribed?: boolean;
      error?: string;
    }>(`/ideas/${encodeURIComponent(ideaId)}/subscribe`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    return {
      ok: Boolean(res?.ok),
      sessionId: res?.session_id,
      subscribed: Boolean(res?.subscribed),
      error: res?.error,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
