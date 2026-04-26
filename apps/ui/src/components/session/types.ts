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
  ideaIds: string[];
  scope: string;
}

export type MessageSegment =
  | { kind: "text"; text: string }
  | { kind: "tool"; event: ToolEvent }
  | { kind: "step"; step: number }
  | { kind: "status"; text: string }
  | { kind: "event_fire"; fire: EventFire }
  | { kind: "file_changed"; event: FileChangedEvent }
  | { kind: "file_deleted"; event: FileDeletedEvent }
  | { kind: "tool_summarized"; event: ToolSummarizedEvent };

export interface Message {
  role: string;
  content: string;
  segments?: MessageSegment[];
  timestamp?: number;
  duration?: string;
  costUsd?: number;
  stepCount?: number;
  tokenUsage?: { prompt: number; completion: number };
  eventType?: string;
  taskId?: string;
  queued?: boolean;
  /**
   * "split" — assistant turn was interrupted by a UserInjected event and
   * committed as a partial entry. Renders identically to a regular assistant
   * bubble but without copy / final-message chrome.
   */
  status?: "split";
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
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
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
 * We allow trailing `event_fire` segments to sit after the final text
 * (post-turn async events still route into the trail), but any tool,
 * step, status, file chip, or summarised-tool segment appearing after
 * a text block disqualifies that text as final.
 */
export function splitTrailAndFinal(segments: MessageSegment[]): {
  trail: MessageSegment[];
  final: MessageSegment[];
} {
  let end = segments.length;
  while (end > 0 && segments[end - 1].kind === "event_fire") {
    end--;
  }
  let start = end;
  while (
    start > 0 &&
    segments[start - 1].kind === "text" &&
    (segments[start - 1] as { kind: "text"; text: string }).text.trim().length > 0
  ) {
    start--;
  }
  if (start === end) {
    return { trail: segments, final: [] };
  }
  const trail = [...segments.slice(0, start), ...segments.slice(end)];
  const final = segments.slice(start, end);
  return { trail, final };
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
