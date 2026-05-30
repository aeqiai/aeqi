import {
  type MessageSegment,
  type ToolEvent,
  type FileChangedEvent,
  type FileDeletedEvent,
  type ToolSummarizedEvent,
  type EntityPrimitive,
  type EntityRef,
  countStepSegments,
} from "./types";

const ENTITY_PRIMITIVES: readonly EntityPrimitive[] = ["agent", "quest", "idea", "event"];

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Drop status fragments that are debug-shaped (UUIDs, JSON envelopes,
 * key:value dumps). Those belong inside their own primitive (tool block,
 * file chip, summarised tool) — not as plain prose in the trail.
 */
function isDebugStatus(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (UUID_RE.test(trimmed)) return true;
  if (/^[[{]/.test(trimmed) && /[\]}]\s*$/.test(trimmed)) return true;
  if (/\b(id|status|payload|tool_use_id|session_id):\s*\S/.test(trimmed)) return true;
  return false;
}

export type RawEvent = Record<string, unknown>;

export interface TurnMeta {
  costUsd?: number;
  stepCount?: number;
  tokenUsage?: { prompt: number; completion: number };
}

export interface LiveParticipant {
  id: string;
  name: string;
  kind: "agent" | "worker";
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
  /**
   * Step number of the last step in the PREVIOUS split segment, if this
   * state is a continuation after a `UserInjected` split. `StepStart` adds
   * `stepOffset` to the counted steps so step numbers carry forward across
   * the split.
   */
  stepOffset: number;
  /**
   * Explicit sender identity — populated when the stream carries from_kind /
   * from_id (Wave 2 schema). When absent the renderer falls back to the
   * legacy `role` mapping.
   */
  from_kind?: "user" | "agent" | "position" | "system" | null;
  from_id?: string | null;
  activeParticipants: LiveParticipant[];
}

/**
 * Result of `reduceStreamEvent`. Most events return `{ kind: "next", state }`.
 * A `UserInjected` event returns `{ kind: "split", commit, next }` — the
 * caller must commit `commit` as a historical assistant message (status=split),
 * push a user bubble, and continue streaming with `next`.
 */
export type ReduceResult =
  | { kind: "next"; state: StreamState }
  | {
      kind: "split";
      commit: StreamState;
      next: StreamState;
      injectedText: string;
      messageId?: number;
    };

export function initialStreamState(thinkingStart: number, stepOffset = 0): StreamState {
  return {
    segments: [],
    fullText: "",
    thinkingStart,
    status: { kind: "streaming" },
    stepOffset,
    from_kind: null,
    from_id: null,
    activeParticipants: [],
  };
}

export function reduceStreamEvent(state: StreamState, event: RawEvent): ReduceResult {
  const type = String(event.type ?? "");
  switch (type) {
    case "Subscribed":
      return { kind: "next", state: applySubscribed(state, event) };
    case "TextDelta":
      return {
        kind: "next",
        state: appendTextWithEntityParsing(state, String(event.text ?? event.delta ?? "")),
      };
    case "EntityRef":
      return {
        kind: "next",
        state: appendEntityRef(state, entityRefFromEvent(event)),
      };
    case "ToolStart":
      return {
        kind: "next",
        state: appendSegment(state, { kind: "tool", event: toolStartEvent(event) }),
      };
    case "ToolResult":
    case "ToolComplete":
      return { kind: "next", state: upsertToolComplete(state, toolCompleteEvent(event)) };
    case "StepStart": {
      const step = countStepSegments(state.segments) + 1 + state.stepOffset;
      return { kind: "next", state: appendSegment(state, { kind: "step", step }) };
    }
    case "IdeaActivity":
    case "MemoryActivity":
      return { kind: "next", state: appendStatus(state, ideaActivityLabel(event)) };
    case "EventFired":
      return {
        kind: "next",
        state: appendSegment(state, { kind: "event_fire", fire: eventFire(event) }),
      };
    case "DelegateStart":
      return {
        kind: "next",
        state: appendStatus(
          upsertActiveParticipant(state, workerParticipant(event)),
          `Delegating to ${event.worker_name ?? "agent"}…`,
        ),
      };
    case "DelegateComplete":
      // Drop the raw `outcome` payload — it can be JSON / UUID dump.
      return {
        kind: "next",
        state: appendStatus(
          removeActiveParticipant(state, workerParticipant(event).id),
          `${event.worker_name ?? "Agent"} finished`,
        ),
      };
    case "FileChanged":
      return {
        kind: "next",
        state: appendSegment(state, { kind: "file_changed", event: fileChanged(event) }),
      };
    case "FileDeleted":
      return {
        kind: "next",
        state: appendSegment(state, { kind: "file_deleted", event: fileDeleted(event) }),
      };
    case "ToolSummarized":
      return {
        kind: "next",
        state: appendSegment(state, { kind: "tool_summarized", event: toolSummarized(event) }),
      };
    case "Compacted":
      return { kind: "next", state: appendStatus(state, compactedLabel(event)) };
    case "SnipCompacted":
      return {
        kind: "next",
        state: appendStatus(state, `snip: freed ~${Number(event.tokens_freed ?? 0)} tokens`),
      };
    case "MicroCompacted":
      return { kind: "next", state: appendStatus(state, microCompactedLabel(event)) };
    case "ContextCollapsed":
      return {
        kind: "next",
        state: appendStatus(state, `collapse: freed ~${Number(event.tokens_freed ?? 0)} tokens`),
      };
    case "Complete":
    case "done":
      return { kind: "next", state: completeIfDone(state, event, type) };
    case "Error":
      return {
        kind: "next",
        state: {
          ...state,
          status: { kind: "error", message: String(event.message ?? "Unknown error") },
        },
      };
    case "UserInjected": {
      // `after_step` is the backend's authoritative step count at the split
      // point. Use it as stepOffset so the continuation's StepStart events
      // number from after_step + 1.
      const afterStep = Number(event.after_step ?? 0);
      const messageId =
        typeof event.message_id === "number" ? (event.message_id as number) : undefined;
      const injectedText = String(event.text ?? "");
      const next = initialStreamState(Date.now(), afterStep);
      return { kind: "split", commit: state, next, injectedText, messageId };
    }
    default:
      return { kind: "next", state };
  }
}

export function hasContent(state: StreamState): boolean {
  return state.fullText.length > 0 || state.segments.length > 0;
}

function applySubscribed(state: StreamState, event: RawEvent): StreamState {
  const msAgo = Number(event.started_ms_ago);
  const next: StreamState = { ...state };
  if (Number.isFinite(msAgo) && msAgo > 0) {
    next.thinkingStart = Date.now() - msAgo;
  }
  // Capture from_kind / from_id when the Subscribed event carries them
  if (event.from_kind != null) {
    next.from_kind = event.from_kind as StreamState["from_kind"];
  }
  if (event.from_id != null) {
    next.from_id = event.from_id as string;
  }
  return next;
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
  if (isDebugStatus(text)) return state;
  return appendSegment(state, { kind: "status", text });
}

function workerParticipant(event: RawEvent): LiveParticipant {
  const name = String(event.worker_name ?? "Agent");
  const id = String(event.worker_id ?? event.agent_id ?? name);
  return { id, name, kind: "worker" };
}

function upsertActiveParticipant(state: StreamState, participant: LiveParticipant): StreamState {
  const activeParticipants = [
    ...state.activeParticipants.filter((current) => current.id !== participant.id),
    participant,
  ];
  return { ...state, activeParticipants };
}

function removeActiveParticipant(state: StreamState, participantId: string): StreamState {
  return {
    ...state,
    activeParticipants: state.activeParticipants.filter((current) => current.id !== participantId),
  };
}

/**
 * Recognises canonical `[[quest:id|Label]]` tokens plus legacy
 * `[Quest: Name]` text and splits them into structured `entity_ref`
 * segments. Backend-emitted `EntityRef` events remain the canonical
 * path; canonical text tokens are the model-facing fallback; label-only
 * legacy tokens are display-only until render-time lookup resolves them.
 */
const ENTITY_REF_RE =
  /\[\[(agent|quest|idea|event):\s*([^|\]]+?)(?:\|([^\]]+?))?\]\]|\[(Agent|Quest|Idea|Event):\s*([^\]]+?)\]/gi;

function entityRefDisplay(ref: EntityRef): string {
  return ref.label || ref.slug || ref.id;
}

function appendEntityRef(state: StreamState, ref: EntityRef): StreamState {
  return {
    ...state,
    segments: [...state.segments, { kind: "entity_ref", ref }],
    fullText: state.fullText + entityRefDisplay(ref),
  };
}

function appendTextWithEntityParsing(state: StreamState, delta: string): StreamState {
  if (!delta) return state;
  let next = state;
  let cursor = 0;
  for (const match of delta.matchAll(ENTITY_REF_RE)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      next = appendText(next, delta.slice(cursor, start));
    }
    const canonicalKind = match[1]?.toLowerCase() as EntityPrimitive | undefined;
    const legacyKind = match[4]?.toLowerCase() as EntityPrimitive | undefined;
    next = appendEntityRef(next, {
      kind: canonicalKind ?? legacyKind ?? "agent",
      id: canonicalKind ? match[2].trim() : "",
      label: canonicalKind ? match[3]?.trim() || undefined : match[5].trim(),
      source: "parser",
    });
    cursor = start + match[0].length;
  }
  if (cursor < delta.length) {
    next = appendText(next, delta.slice(cursor));
  }
  return next;
}

function entityRefFromEvent(event: RawEvent): EntityRef {
  const raw = String(event.primitive ?? event.kind ?? "").toLowerCase();
  const primitive = (ENTITY_PRIMITIVES as readonly string[]).includes(raw)
    ? (raw as EntityPrimitive)
    : "agent";
  const id =
    typeof event.ref_id === "string"
      ? event.ref_id
      : typeof event.entity_id === "string"
        ? event.entity_id
        : typeof event.target_id === "string"
          ? event.target_id
          : typeof event[`${primitive}_id`] === "string"
            ? (event[`${primitive}_id`] as string)
            : typeof event.id === "string"
              ? event.id
              : "";
  return {
    kind: primitive,
    id,
    trustId: typeof event.trust_id === "string" ? event.trust_id : undefined,
    label:
      typeof event.label === "string"
        ? event.label
        : typeof event.name === "string"
          ? event.name
          : undefined,
    slug: typeof event.slug === "string" ? event.slug : undefined,
    status: typeof event.status === "string" ? event.status : undefined,
    source: event.source === "tool" ? "tool" : "model",
  };
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
  return {
    eventId: String(event.event_id ?? ""),
    eventName: String(event.event_name ?? ""),
    pattern: String(event.pattern ?? ""),
    scope: typeof event.scope === "string" && event.scope.length > 0 ? event.scope : "self",
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
