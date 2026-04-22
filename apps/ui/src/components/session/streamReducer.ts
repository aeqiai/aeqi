import {
  type MessageSegment,
  type ToolEvent,
  type FileChangedEvent,
  type FileDeletedEvent,
  type ToolSummarizedEvent,
  countStepSegments,
} from "./types";

export type RawEvent = Record<string, unknown>;

export interface TurnMeta {
  costUsd?: number;
  stepCount?: number;
  tokenUsage?: { prompt: number; completion: number };
}

export type StreamStatus =
  | { kind: "streaming" }
  | { kind: "complete"; meta: TurnMeta }
  | { kind: "error"; message: string };

export interface StreamState {
  segments: MessageSegment[];
  fullText: string;
  thinkingStart: number;
  status: StreamStatus;
}

export function initialStreamState(thinkingStart: number): StreamState {
  return {
    segments: [],
    fullText: "",
    thinkingStart,
    status: { kind: "streaming" },
  };
}

export function reduceStreamEvent(state: StreamState, event: RawEvent): StreamState {
  const type = String(event.type ?? "");
  switch (type) {
    case "Subscribed":
      return applySubscribed(state, event);
    case "TextDelta":
      return appendText(state, String(event.text ?? event.delta ?? ""));
    case "ToolStart":
      return appendSegment(state, { kind: "tool", event: toolStartEvent(event) });
    case "ToolResult":
    case "ToolComplete":
      return upsertToolComplete(state, toolCompleteEvent(event));
    case "StepStart":
      return appendSegment(state, { kind: "step", step: countStepSegments(state.segments) + 1 });
    case "IdeaActivity":
    case "MemoryActivity":
      return appendStatus(state, ideaActivityLabel(event));
    case "EventFired":
      return appendSegment(state, { kind: "event_fire", fire: eventFire(event) });
    case "DelegateStart":
      return appendStatus(state, `Delegating to ${event.worker_name ?? "agent"}...`);
    case "DelegateComplete":
      return appendStatus(
        state,
        `${event.worker_name ?? "Agent"} finished: ${event.outcome ?? "done"}`,
      );
    case "FileChanged":
      return appendSegment(state, { kind: "file_changed", event: fileChanged(event) });
    case "FileDeleted":
      return appendSegment(state, { kind: "file_deleted", event: fileDeleted(event) });
    case "ToolSummarized":
      return appendSegment(state, { kind: "tool_summarized", event: toolSummarized(event) });
    case "Compacted":
      return appendStatus(state, compactedLabel(event));
    case "SnipCompacted":
      return appendStatus(state, `snip: freed ~${Number(event.tokens_freed ?? 0)} tokens`);
    case "MicroCompacted":
      return appendStatus(state, microCompactedLabel(event));
    case "ContextCollapsed":
      return appendStatus(state, `collapse: freed ~${Number(event.tokens_freed ?? 0)} tokens`);
    case "Complete":
    case "done":
      return completeIfDone(state, event, type);
    case "Error":
      return {
        ...state,
        status: { kind: "error", message: String(event.message ?? "Unknown error") },
      };
    default:
      return state;
  }
}

export function hasContent(state: StreamState): boolean {
  return state.fullText.length > 0 || state.segments.length > 0;
}

function applySubscribed(state: StreamState, event: RawEvent): StreamState {
  const msAgo = Number(event.started_ms_ago);
  if (!Number.isFinite(msAgo) || msAgo <= 0) return state;
  return { ...state, thinkingStart: Date.now() - msAgo };
}

function appendText(state: StreamState, delta: string): StreamState {
  if (!delta) return state;
  const last = state.segments[state.segments.length - 1];
  const segments =
    last && last.kind === "text"
      ? [...state.segments.slice(0, -1), { kind: "text" as const, text: last.text + delta }]
      : [...state.segments, { kind: "text" as const, text: delta }];
  return { ...state, segments, fullText: state.fullText + delta };
}

function appendSegment(state: StreamState, segment: MessageSegment): StreamState {
  return { ...state, segments: [...state.segments, segment] };
}

function appendStatus(state: StreamState, text: string): StreamState {
  return appendSegment(state, { kind: "status", text });
}

function upsertToolComplete(state: StreamState, completed: ToolEvent): StreamState {
  const idx = state.segments.findIndex(
    (s) =>
      s.kind === "tool" &&
      s.event.type === "start" &&
      ((completed.id && s.event.id === completed.id) ||
        (!completed.id && s.event.name === completed.name)),
  );
  if (idx < 0) return appendSegment(state, { kind: "tool", event: completed });
  const segments = [...state.segments];
  segments[idx] = { kind: "tool", event: completed };
  return { ...state, segments };
}

function completeIfDone(state: StreamState, event: RawEvent, type: string): StreamState {
  if (!event.done && type === "Complete") return state;
  const meta: TurnMeta = {};
  const cost = Number(event.cost_usd);
  if (Number.isFinite(cost) && cost > 0) meta.costUsd = cost;
  const steps = countStepSegments(state.segments);
  if (steps > 0) meta.stepCount = steps;
  const prompt = Number(event.prompt_tokens);
  const completion = Number(event.completion_tokens);
  if ((Number.isFinite(prompt) && prompt > 0) || (Number.isFinite(completion) && completion > 0)) {
    meta.tokenUsage = {
      prompt: Number.isFinite(prompt) ? prompt : 0,
      completion: Number.isFinite(completion) ? completion : 0,
    };
  }
  return { ...state, status: { kind: "complete", meta } };
}

function toolStartEvent(event: RawEvent): ToolEvent {
  return {
    type: "start",
    name: toolName(event),
    id: toolId(event),
    timestamp: Date.now(),
  };
}

function toolCompleteEvent(event: RawEvent): ToolEvent {
  return {
    type: "complete",
    name: toolName(event),
    id: toolId(event),
    success: event.success !== false,
    input_preview: (event.input_preview as string) || undefined,
    output_preview: String(event.output_preview ?? event.output ?? ""),
    duration_ms: Number(event.duration_ms) || undefined,
    timestamp: Date.now(),
  };
}

function toolName(event: RawEvent): string {
  return String(event.name ?? event.tool_name ?? event.tool_use_id ?? "tool");
}

function toolId(event: RawEvent): string | undefined {
  const id = event.tool_use_id ?? event.id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

function ideaActivityLabel(event: RawEvent): string {
  const name = String(event.name ?? "idea");
  return event.action === "stored" ? `Stored: ${name}` : `Recalled: ${name}`;
}

function eventFire(event: RawEvent) {
  const ideaIds = Array.isArray(event.idea_ids) ? event.idea_ids.map(String) : [];
  return {
    eventId: String(event.event_id ?? ""),
    eventName: String(event.event_name ?? ""),
    pattern: String(event.pattern ?? ""),
    ideaIds,
  };
}

function fileChanged(event: RawEvent): FileChangedEvent {
  return {
    path: String(event.path ?? ""),
    operation: event.operation === "created" ? "created" : "modified",
    bytes: Number(event.bytes ?? 0),
  };
}

function fileDeleted(event: RawEvent): FileDeletedEvent {
  return { path: String(event.path ?? "") };
}

function toolSummarized(event: RawEvent): ToolSummarizedEvent {
  return {
    tool_use_id: String(event.tool_use_id ?? ""),
    tool_name: String(event.tool_name ?? ""),
    original_bytes: Number(event.original_bytes ?? 0),
    summary: String(event.summary ?? ""),
  };
}

function compactedLabel(event: RawEvent): string {
  const restored = Array.isArray(event.restored_files) ? event.restored_files.map(String) : [];
  const orig = Number(event.original_messages ?? 0);
  const remaining = Number(event.remaining_messages ?? 0);
  if (restored.length === 0) return `context compacted (${orig}→${remaining} msgs)`;
  const suffix = restored.length === 1 ? "" : "s";
  return `context compacted (${orig}→${remaining} msgs, restored ${restored.length} file${suffix})`;
}

function microCompactedLabel(event: RawEvent): string {
  const cleared = Number(event.cleared ?? 0);
  const suffix = cleared === 1 ? "" : "s";
  return `microcompact: cleared ${cleared} old tool result${suffix}`;
}
