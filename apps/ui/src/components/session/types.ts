import { formatShortTime } from "@/lib/i18n";

export interface ToolEvent {
  type: "start" | "complete" | "step" | "status";
  name: string;
  id?: string;
  success?: boolean;
  input_preview?: string;
  output_preview?: string;
  duration_ms?: number;
  timestamp: number;
}

export type FileOperation = "created" | "modified";

export interface FileChangedEvent {
  path: string;
  operation: FileOperation;
  bytes: number;
}

export interface FileDeletedEvent {
  path: string;
}

export interface ToolSummarizedEvent {
  tool_use_id: string;
  tool_name: string;
  original_bytes: number;
  summary: string;
}

export interface EventFire {
  eventId: string;
  eventName: string;
  pattern: string;
  scope: string;
}

/**
 * Structured reference to an aeqi primitive (agent / quest / idea / event).
 * IDs are canonical: labels and slugs are display metadata only. Label-only
 * parser fallbacks are allowed, but render unresolved until local state can
 * map them to a real id.
 */
export type EntityPrimitive = "agent" | "quest" | "idea" | "event";
export interface EntityRef {
  kind: EntityPrimitive;
  id: string;
  trustId?: string;
  label?: string;
  slug?: string;
  status?: string;
  source?: "tool" | "model" | "parser";
}

export type MessageSegment =
  | { kind: "text"; text: string }
  | { kind: "tool"; event: ToolEvent }
  | { kind: "step"; step: number }
  | { kind: "status"; text: string }
  | { kind: "event_fire"; fire: EventFire }
  | { kind: "file_changed"; event: FileChangedEvent }
  | { kind: "file_deleted"; event: FileDeletedEvent }
  | { kind: "tool_summarized"; event: ToolSummarizedEvent }
  | { kind: "entity_ref"; ref: EntityRef };

export interface Message {
  role: string;
  /**
   * WHO sent this message — schema-aligned with session_messages.from_kind.
   * Nullable; when absent the renderer falls back to `role` mapping.
   */
  from_kind?: "user" | "agent" | "position" | "system" | null;
  /**
   * The identity ID of the sender (agent UUID, user UUID, or position UUID).
   * Nullable; only meaningful when from_kind is set.
   */
  from_id?: string | null;
  content: string;
  sender?: {
    id?: string;
    display_name?: string;
    transport?: string;
    transport_id?: string;
    avatar_url?: string | null;
    metadata?: Record<string, unknown> | null;
  };
  transport?: string;
  segments?: MessageSegment[];
  timestamp?: number;
  duration?: string;
  costUsd?: number;
  stepCount?: number;
  tokenUsage?: { prompt: number; completion: number };
  eventType?: string;
  taskId?: string;
  quest?: {
    id?: string;
    subject?: string;
    status?: string;
    runtime?: string | null;
    outcomeSummary?: string | null;
  };
  queued?: boolean;
  /**
   * "split" — assistant turn was interrupted by a UserInjected event and
   * committed as a partial entry. Renders identically to a regular assistant
   * bubble but without copy / final-message chrome.
   */
  status?: "split";
  /**
   * `true` when the assistant turn was reconstructed from DB rows but no
   * `assistant_complete` row was seen — the turn is still streaming. Used
   * by the live-attach path to skip rendering the partial DB version (the
   * StreamingMessage replays the same content from backlog).
   */
  draft?: boolean;
  /** Populated when role === "event_fire". */
  eventFire?: EventFire;
  /** DB message ID — used for fork-from-here. */
  messageId?: number;
  /**
   * `session_messages.source` — set when a tool that records to the
   * transcript wants the renderer to give the message special treatment.
   * Today `"question.ask"` triggers the ink-panel "asking the director"
   * presentation in the chat surface.
   */
  source?: string;
  /**
   * Companion to `source = "question.ask"` — the inbox row's preview
   * subject. Surfaced in the message panel header.
   */
  askSubject?: string;
}

export function questIdFromText(text: string): string | undefined {
  const match = text.match(/\b(?:platform-\d+|\d{2,3}-\d{3}|[0-9a-f]{8}-[0-9a-f-]{27})\b/i);
  return match?.[0];
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function questIdFromMeta(meta: Record<string, unknown>): string | undefined {
  return stringFrom(meta.quest_id) ?? stringFrom(meta.task_id);
}

export function questSnapshotFromMeta(
  meta: Record<string, unknown>,
): NonNullable<Message["quest"]> {
  const rawTask =
    meta.task && typeof meta.task === "object" && !Array.isArray(meta.task)
      ? (meta.task as Record<string, unknown>)
      : null;
  const rawOutcome =
    rawTask?.outcome && typeof rawTask.outcome === "object" && !Array.isArray(rawTask.outcome)
      ? (rawTask.outcome as Record<string, unknown>)
      : null;
  return {
    id: stringFrom(rawTask?.id) ?? questIdFromMeta(meta),
    subject:
      stringFrom(rawTask?.subject) ??
      stringFrom(rawTask?.title) ??
      stringFrom(rawTask?.name) ??
      stringFrom(meta.subject),
    status: stringFrom(rawTask?.status) ?? stringFrom(meta.status) ?? stringFrom(meta.to),
    runtime: stringFrom(rawTask?.runtime) ?? null,
    outcomeSummary: stringFrom(rawOutcome?.summary) ?? stringFrom(meta.summary) ?? null,
  };
}

export interface SessionInfo {
  id: string;
  agent_id?: string;
  agent_name?: string;
  name?: string;
  session_type?: string;
  status: string;
  created_at: string;
  last_active?: string;
  message_count?: number;
  first_message?: string;
  gateway_channel_id?: string | null;
  gateway_channel_key?: string | null;
  gateway_transport?: string | null;
  gateway_peer_id?: string | null;
  gateway_sender_id?: string | null;
  gateway_sender_name?: string | null;
  gateway_sender_transport_id?: string | null;
}

export function formatTransportLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) =>
      part.toLowerCase() === "whatsapp" ? "WhatsApp" : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(" ");
}

export function gatewayLabel(
  s: Pick<
    SessionInfo,
    "gateway_transport" | "gateway_peer_id" | "gateway_sender_name" | "gateway_sender_transport_id"
  >,
) {
  const transport = formatTransportLabel(s.gateway_transport);
  if (!transport) return null;
  const person = s.gateway_sender_name?.trim() || null;
  const peer = s.gateway_sender_transport_id || s.gateway_peer_id;
  const identity = person && peer && person !== peer ? `${person} · ${peer}` : person || peer;
  return identity ? `${transport} · ${identity}` : transport;
}

// ── Author resolution ──────────────────────────────────────────────────────

export type ResolvedAuthor =
  | { kind: "user"; id: string; name: string }
  | { kind: "agent"; id: string; name: string }
  | { kind: "position"; id: string; title: string }
  | { kind: "system" };

export interface AuthorContext {
  sessionAgentId: string;
  agentNames: Map<string, string>;
  userName: string;
  positionTitles?: Map<string, string>;
}

export function resolveAuthor(msg: Message, ctx: AuthorContext): ResolvedAuthor {
  const { from_kind, from_id, role } = msg;
  const { sessionAgentId, agentNames, userName, positionTitles } = ctx;

  // Explicit from_kind — schema-aligned path
  if (from_kind === "system" || role === "system") {
    return { kind: "system" };
  }
  if (from_kind === "agent") {
    const id = from_id ?? sessionAgentId;
    return { kind: "agent", id, name: agentNames.get(id) ?? "Agent" };
  }
  if (from_kind === "user") {
    const id = from_id ?? "";
    return { kind: "user", id, name: userName };
  }
  if (from_kind === "position") {
    const id = from_id ?? "";
    return { kind: "position", id, title: positionTitles?.get(id) ?? "Position" };
  }

  // Legacy fallback — role-based
  if (role === "assistant") {
    return { kind: "agent", id: sessionAgentId, name: agentNames.get(sessionAgentId) ?? "Agent" };
  }
  if (role === "user" || role === "User") {
    return { kind: "user", id: "", name: userName };
  }

  // Default: treat as system for event_fire / quest_event / error roles
  return { kind: "system" };
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatDuration(startMs: number, endMs: number): string {
  const diff = endMs - startMs;
  if (diff < 1000) return "<1s";
  if (diff < 60000) return `${Math.round(diff / 1000)}s`;
  return `${Math.floor(diff / 60000)}m ${Math.round((diff % 60000) / 1000)}s`;
}

export function formatTime(ts: number): string {
  return formatShortTime(ts, { fallback: "" });
}

export const TOOL_LABELS: Record<string, string> = {
  agents: "Agents",
  quests: "Quests",
  events: "Events",
  ideas: "Ideas",
  code: "Code",
  read_file: "Read file",
  write_file: "Write file",
  edit_file: "Edit file",
  list_dir: "List directory",
  glob: "Find files",
  grep: "Search code",
  shell: "Run command",
  web_search: "Web search",
  web_fetch: "Fetch URL",
};

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] || name.replace(/_/g, " ");
}

export function shouldRenderStatus(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  if (/^step \d+$/.test(normalized)) return false;
  if (normalized === "recalling ideas...") return false;
  return true;
}

export function numberFromMeta(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

export function formatStepCount(count: number): string {
  return `${count} step${count === 1 ? "" : "s"}`;
}

export function formatContinuingFromStep(step: number): string {
  return `Continuing from step ${step}`;
}

export function countStepSegments(segments?: MessageSegment[]): number {
  return segments?.filter((seg) => seg.kind === "step").length || 0;
}

/**
 * Split an assistant turn's segments into the intermediate "trail" and
 * the "final" response. Only a contiguous run of text at the very end
 * of the turn qualifies as final — intermediate narrations like "Let
 * me check X:" that sit before another tool/step belong in the trail,
 * not below the thinking panel.
 *
 * We allow trailing operational segments to sit after the final text
 * (post-turn async events and persisted tool/file summaries still route
 * into the trail), but a trailing step marker still disqualifies that
 * text as final because it means the turn boundary is ambiguous.
 */
export function splitTrailAndFinal(segments: MessageSegment[]): {
  trail: MessageSegment[];
  final: MessageSegment[];
} {
  let end = segments.length;
  while (end > 0 && isTrailingOperationalSegment(segments[end - 1])) {
    end--;
  }
  // Walk backwards over the contiguous run of final content (text +
  // entity_ref). Tools, steps, status, file chips break the run.
  let start = end;
  while (start > 0) {
    const seg = segments[start - 1];
    if (seg.kind === "entity_ref") {
      start--;
    } else if (seg.kind === "text" && seg.text.trim().length > 0) {
      start--;
    } else {
      break;
    }
  }
  if (start === end) {
    return { trail: segments, final: [] };
  }
  const trail = [...segments.slice(0, start), ...segments.slice(end)];
  const final = segments.slice(start, end);
  return { trail, final };
}

function isTrailingOperationalSegment(seg: MessageSegment): boolean {
  return (
    seg.kind === "event_fire" ||
    seg.kind === "status" ||
    seg.kind === "file_changed" ||
    seg.kind === "file_deleted" ||
    seg.kind === "tool_summarized"
  );
}

export function trailHasFailure(segments: MessageSegment[]): boolean {
  return segments.some((s) => s.kind === "tool" && s.event.success === false);
}

/**
 * A trail is worth collapsing only if it contains something a user would
 * actually want to inspect — a tool call, a file write, an injected idea, a
 * summarised tool. A solo synthesised `step` marker doesn't count (expanding
 * would reveal nothing useful and the pill would feel like a lie).
 */
export function trailHasMeaningfulContent(segments: MessageSegment[]): boolean {
  return segments.some(
    (s) =>
      s.kind === "tool" ||
      s.kind === "file_changed" ||
      s.kind === "file_deleted" ||
      s.kind === "event_fire" ||
      s.kind === "tool_summarized",
  );
}

export function applyAssistantMeta(message: Message, meta: Record<string, unknown>) {
  const durationMs = numberFromMeta(meta.duration_ms);
  const costUsd = numberFromMeta(meta.cost_usd);
  const stepCount = numberFromMeta(meta.iterations ?? meta.steps ?? meta.step_count);
  const promptTokens = numberFromMeta(meta.prompt_tokens ?? meta.total_prompt_tokens);
  const completionTokens = numberFromMeta(meta.completion_tokens ?? meta.total_completion_tokens);

  if (durationMs != null && durationMs > 0) {
    message.duration = formatDuration(0, durationMs);
  }
  if (costUsd != null && costUsd > 0) {
    message.costUsd = costUsd;
  }
  if (stepCount != null && stepCount > 0) {
    message.stepCount = Math.round(stepCount);
  }
  if (
    (promptTokens != null && promptTokens > 0) ||
    (completionTokens != null && completionTokens > 0)
  ) {
    message.tokenUsage = {
      prompt: Math.round(promptTokens || 0),
      completion: Math.round(completionTokens || 0),
    };
  }
}

export function currentRunningToolName(segments: MessageSegment[]): string | undefined {
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (seg.kind === "tool" && seg.event.type === "start") {
      return toolLabel(seg.event.name);
    }
  }
  return undefined;
}

// Names that are session-default rather than session-meaningful — fall
// through to first_message instead of treating these as titles.
const GENERIC_SESSION_NAMES = /^(permanent session|session|new session|fork)(\s*\(.*\))?$/i;

/** Derive a short display label for a session */
export function sessionLabel(s: SessionInfo): string {
  if (s.name) {
    const stripped = s.name
      .replace(/^Telegram DM:\s*/i, "")
      .replace(/^Telegram Group\s*/i, "Group")
      .replace(/^telegram:\s*/i, "")
      .replace(/^whatsapp:\s*/i, "");
    const trimmed = stripped.trim();
    // Sessions that inherited the agent's name/slug carry no session-specific
    // info — treat them as untitled and fall through to first_message.
    const looksLikeAgentRef = s.agent_name && trimmed.toLowerCase() === s.agent_name.toLowerCase();
    if (
      stripped &&
      stripped !== s.id &&
      !stripped.startsWith("session-") &&
      !GENERIC_SESSION_NAMES.test(trimmed) &&
      !looksLikeAgentRef
    ) {
      return stripped;
    }
  }
  if (s.first_message) {
    const words = s.first_message
      .replace(/[\n\r]+/g, " ")
      .trim()
      .split(/\s+/)
      .slice(0, 8);
    const label = words.join(" ");
    return label.length > 40 ? label.slice(0, 38) + "…" : label;
  }
  return "Untitled";
}
