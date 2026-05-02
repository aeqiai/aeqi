/**
 * Session-layer API calls for the Idea conversation panel.
 *
 * Backend endpoints for /ideas/:id/activity and /ideas/:id/comments do not
 * yet exist — the Senior Architect is shipping them in parallel. All three
 * functions stub gracefully: they return empty arrays and log a warning so the
 * UI renders empty states until the backend catches up.
 *
 * getIdeaActivity   — activity_log rows + system session_messages for idea
 * getIdeaComments   — non-system session_messages for idea.session_id
 * messageTo         — new IPC `message_to` (target = {kind:"idea", id})
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
  /** Sender display name */
  author: string;
  /** Author kind: user / agent / position */
  author_kind: "user" | "agent" | "position" | string;
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
  rows: Array<{
    id: string | number;
    timestamp: string;
    summary: string;
    event_type?: string;
    metadata?: Record<string, unknown>;
  }>;
}

/** Wire shape from GET /ideas/:id/comments */
interface CommentsResponse {
  ok: boolean;
  rows: Array<{
    id: string | number;
    timestamp: string;
    author: string;
    author_kind: string;
    body: string;
  }>;
}

export type MessageToError = { kind: "unknown_command" | "api_error"; message: string };
export type MessageToResult = { ok: true } | { ok: false; error: MessageToError };

// ─── API functions ─────────────────────────────────────────────────────────────

export async function getIdeaActivity(ideaId: string): Promise<ActivityRow[]> {
  try {
    const res = await apiRequest<ActivityResponse>(`/ideas/${encodeURIComponent(ideaId)}/activity`);
    return res.rows.map((r) => ({ kind: "activity" as const, ...r }));
  } catch (err) {
    // Backend endpoint not yet available — stub.
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes("404") ||
      msg.includes("unknown_command") ||
      msg.includes("not found") ||
      msg.includes("Not Found")
    ) {
      console.warn("[sessions] getIdeaActivity: endpoint not yet available, returning empty");
      return [];
    }
    throw err;
  }
}

export async function getIdeaComments(ideaId: string): Promise<CommentRow[]> {
  try {
    const res = await apiRequest<CommentsResponse>(`/ideas/${encodeURIComponent(ideaId)}/comments`);
    return res.rows.map((r) => ({ kind: "comment" as const, ...r }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes("404") ||
      msg.includes("unknown_command") ||
      msg.includes("not found") ||
      msg.includes("Not Found")
    ) {
      console.warn("[sessions] getIdeaComments: endpoint not yet available, returning empty");
      return [];
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
    await apiRequest<{ ok: boolean }>("/ipc/message_to", {
      method: "POST",
      body: JSON.stringify(params),
    });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("unknown_command") || msg.includes("404") || msg.includes("Not Found")) {
      return {
        ok: false,
        error: { kind: "unknown_command", message: "message_to IPC not yet available" },
      };
    }
    return { ok: false, error: { kind: "api_error", message: msg } };
  }
}
