// ── Types ──

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

export type MessageSegment =
  | { kind: "text"; text: string }
  | { kind: "tool"; event: ToolEvent }
  | { kind: "step"; step: number }
  | { kind: "status"; text: string };

export interface EventFire {
  eventId: string;
  eventName: string;
  pattern: string;
  ideaIds: string[];
}

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
  /** Populated when role === "event_fire". */
  eventFire?: EventFire;
  /** DB message ID — used for fork-from-here. */
  messageId?: number;
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

// ── Helpers ──

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

// ── Tool display helpers ──

export const TOOL_LABELS: Record<string, string> = {
  // Four primitives
  agents: "Agents",
  quests: "Quests",
  events: "Events",
  ideas: "Ideas",
  // Code intelligence
  code: "Code",
  // Files
  read_file: "Read file",
  write_file: "Write file",
  edit_file: "Edit file",
  list_dir: "List directory",
  glob: "Find files",
  grep: "Search code",
  // System
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

export function countStepSegments(segments?: MessageSegment[]): number {
  return segments?.filter((seg) => seg.kind === "step").length || 0;
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

/** Derive a short display label for a session */
export function sessionLabel(s: SessionInfo): string {
  if (s.name) {
    // Strip transport prefix — the badge already shows TG/WA.
    const stripped = s.name
      .replace(/^Telegram DM:\s*/i, "")
      .replace(/^Telegram Group\s*/i, "Group")
      .replace(/^telegram:\s*/i, "")
      .replace(/^whatsapp:\s*/i, "");
    if (stripped && stripped !== s.id && !stripped.startsWith("session-")) return stripped;
  }
  // Derive from first message — first ~5 words.
  if (s.first_message) {
    const words = s.first_message
      .replace(/[\n\r]+/g, " ")
      .trim()
      .split(/\s+/)
      .slice(0, 6);
    const label = words.join(" ");
    return label.length > 32 ? label.slice(0, 30) + "..." : label;
  }
  return s.id.slice(0, 8);
}
