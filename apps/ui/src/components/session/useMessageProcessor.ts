import { useCallback } from "react";
import {
  type Message,
  type MessageSegment,
  type ToolEvent,
  type EventFire,
  countStepSegments,
  numberFromMeta,
  applyAssistantMeta,
} from "./types";

export function useMessageProcessor() {
  return useCallback((rawMessages: Array<Record<string, unknown>>): Message[] => {
    const processed: Message[] = [];
    let pendingTools: MessageSegment[] = [];
    let currentAgent: Message | null = null;
    let stepCount = 0;
    let sawStoredStepMarkers = false;
    // Tracks whether the current assistant turn has been sealed by an
    // `assistant_complete` row. Reset on every new user message and on
    // flush. If the turn flushes without a seal, it's a still-streaming
    // turn reconstructed mid-flight — flag it as draft so the live-attach
    // path can drop it before the StreamingMessage replays the content.
    let currentCompleted = false;

    const flushAgent = () => {
      if (currentAgent) {
        if (!currentAgent.stepCount) {
          currentAgent.stepCount = countStepSegments(currentAgent.segments);
        }
        if (!currentCompleted) {
          currentAgent.draft = true;
        }
        processed.push(currentAgent);
        currentAgent = null;
      }
      currentCompleted = false;
    };

    const ensureCurrentAgent = (timestamp: number) => {
      if (!currentAgent) {
        currentAgent = {
          role: "assistant",
          content: "",
          segments: [],
          timestamp,
        };
      }
      return currentAgent;
    };

    const startStep = (_step: number | undefined, timestamp: number) => {
      const message = ensureCurrentAgent(timestamp);
      stepCount += 1;
      message.stepCount = Math.max(message.stepCount || 0, stepCount);
      message.segments!.push({ kind: "step", step: stepCount });
      return message;
    };

    const applyMetaToCurrentAssistant = (meta: Record<string, unknown>) => {
      if (currentAgent) {
        applyAssistantMeta(currentAgent, meta);
        return;
      }
      for (let i = processed.length - 1; i >= 0; i--) {
        if (processed[i].role === "assistant") {
          applyAssistantMeta(processed[i], meta);
          return;
        }
      }
    };

    for (const m of rawMessages) {
      const eventType = m.event_type || "message";
      const ts = m.created_at ? new Date(String(m.created_at)).getTime() : Date.now();

      if (eventType === "tool_complete") {
        const meta = (m.metadata || {}) as Record<string, unknown>;
        pendingTools.push({
          kind: "tool",
          event: {
            type: "complete",
            name: String(meta.tool_name || m.content || "tool"),
            id: meta.tool_use_id ? String(meta.tool_use_id) : undefined,
            success: meta.success !== false,
            input_preview: meta.input_preview as string | undefined,
            output_preview: meta.output_preview as string | undefined,
            duration_ms: meta.duration_ms as number | undefined,
            timestamp: ts,
          },
        });
      } else if (eventType === "step_start") {
        const meta = (m.metadata || {}) as Record<string, unknown>;
        sawStoredStepMarkers = true;
        if (pendingTools.length > 0 && currentAgent) {
          currentAgent.segments!.push(...pendingTools);
          pendingTools = [];
        }
        startStep(numberFromMeta(meta.step), ts);
      } else if (eventType === "assistant_complete") {
        currentCompleted = true;
        if (currentAgent && typeof m.id === "number") {
          currentAgent.messageId = m.id;
        }
        if (!currentAgent && pendingTools.length > 0) {
          currentAgent = {
            role: "assistant",
            content: "",
            segments: [],
            timestamp: ts,
          };
          if (!sawStoredStepMarkers) {
            startStep(undefined, ts);
          }
          currentAgent.segments!.push(...pendingTools);
          pendingTools = [];
        }
        applyMetaToCurrentAssistant((m.metadata || {}) as Record<string, unknown>);
        // Seal the turn now. Without this, lifecycle event_fired rows for
        // the NEXT turn (session:execution_start fires before the next
        // user message lands) get appended to the previous turn's segments
        // instead of being held for fold-into-next-trail.
        flushAgent();
        stepCount = 0;
        sawStoredStepMarkers = false;
      } else if (m.role === "assistant") {
        const agent = !sawStoredStepMarkers ? startStep(undefined, ts) : ensureCurrentAgent(ts);
        if (agent.timestamp == null) {
          agent.timestamp = ts;
        } else {
          agent.timestamp = Math.min(agent.timestamp, ts);
        }
        if (pendingTools.length > 0) {
          agent.segments!.push(...pendingTools);
          pendingTools = [];
        }
        const text = String(m.content || "");
        if (text) {
          agent.segments!.push({ kind: "text", text });
          agent.content += (agent.content ? "\n\n" : "") + text;
        }
        // `source = "question.ask"` flags this message as a director-ask
        // for the renderer. The companion `metadata.subject` carries the
        // inbox row preview line. Stamp them on the assistant Message so
        // MessageItem can drape an ink panel around the bubble.
        const rawSource = typeof m.source === "string" ? m.source : null;
        if (rawSource === "question.ask") {
          agent.source = "question.ask";
          const meta = (m.metadata || {}) as Record<string, unknown>;
          if (typeof meta.subject === "string") {
            agent.askSubject = meta.subject;
          }
        }
        applyAssistantMeta(agent, (m.metadata || {}) as Record<string, unknown>);
      } else if (eventType === "event_fired") {
        const meta = (m.metadata || {}) as Record<string, unknown>;
        const rawIdeaIds = meta.idea_ids;
        const ideaIds = Array.isArray(rawIdeaIds) ? rawIdeaIds.map(String) : [];
        const fire = {
          eventId: String(meta.event_id ?? ""),
          eventName: String(meta.event_name ?? ""),
          pattern: String(meta.pattern ?? ""),
          ideaIds,
          scope: typeof meta.scope === "string" && meta.scope.length > 0 ? meta.scope : "self",
        };
        // Mid-turn fires (the agent is already producing output) inline at
        // their firing point. Between-turn fires (session:start before any
        // user message, session:execution_start before the first segment of
        // a turn) are emitted as standalone event_fire rows; the post-pass
        // below folds them into the next assistant turn's trail.
        if (currentAgent && currentAgent.segments!.length > 0) {
          if (pendingTools.length > 0) {
            currentAgent.segments!.push(...pendingTools);
            pendingTools = [];
          }
          currentAgent.segments!.push({ kind: "event_fire", fire });
        } else {
          processed.push({
            role: "event_fire",
            content: "",
            timestamp: ts,
            eventFire: fire,
          });
        }
      } else if (m.role === "user" || m.role === "User") {
        if (pendingTools.length > 0 && currentAgent) {
          currentAgent.segments!.push(...pendingTools);
          pendingTools = [];
        }
        flushAgent();
        stepCount = 0;
        sawStoredStepMarkers = false;
        processed.push({
          role: "user",
          content: String(m.content || ""),
          timestamp: ts,
          messageId: typeof m.id === "number" ? m.id : undefined,
        });
      }
    }
    // Flush remaining
    if (pendingTools.length > 0 && currentAgent) {
      currentAgent.segments!.push(...pendingTools);
    } else if (pendingTools.length > 0) {
      const firstTool = pendingTools.find(
        (seg): seg is { kind: "tool"; event: ToolEvent } => seg.kind === "tool",
      );
      currentAgent = {
        role: "assistant",
        content: "",
        segments: [],
        timestamp: firstTool?.event.timestamp || Date.now(),
      };
      if (!sawStoredStepMarkers) {
        startStep(undefined, currentAgent.timestamp || Date.now());
      }
      currentAgent.segments!.push(...pendingTools);
    }
    flushAgent();
    return foldEventFiresIntoTrails(processed);
  }, []);
}

/**
 * Single linear pass that folds standalone `event_fire` rows into the
 * upcoming assistant turn as `event_fire` segments at the front of its trail.
 * This is the declarative replacement for in-processor buffering: the
 * timeline is built strictly in chronological order, then this pass moves
 * inter-turn injections into where they belong visually — after the user
 * input, inside the collapsible trail.
 *
 * Lifecycle events (`session:execution_start`, idea injections) are
 * pre-persisted BEFORE the user-message row of the turn they belong to —
 * so pending fires must carry across exactly one user message and attach
 * to the next assistant. Only flush as orphan trail when a SECOND user
 * message arrives without an assistant in between (abandoned turn) or at
 * end of input (post-turn async fires).
 */
function foldEventFiresIntoTrails(messages: Message[]): Message[] {
  const out: Message[] = [];
  let pending: { fire: EventFire; ts: number }[] = [];
  let userSeenSincePending = false;

  const flushPendingAsTrail = () => {
    if (pending.length === 0) return;
    const trailMsg: Message = {
      role: "assistant",
      content: "",
      segments: pending.map(({ fire }) => ({ kind: "event_fire" as const, fire })),
      timestamp: pending[pending.length - 1].ts,
    };
    out.push(trailMsg);
    pending = [];
    userSeenSincePending = false;
  };

  for (const m of messages) {
    if (m.role === "event_fire" && m.eventFire) {
      pending.push({ fire: m.eventFire, ts: m.timestamp ?? Date.now() });
      continue;
    }
    if (m.role === "assistant" && pending.length > 0) {
      const fireSegs: MessageSegment[] = pending.map(({ fire }) => ({
        kind: "event_fire" as const,
        fire,
      }));
      m.segments = [...fireSegs, ...(m.segments ?? [])];
      pending = [];
      userSeenSincePending = false;
    } else if (m.role === "user" && pending.length > 0) {
      if (userSeenSincePending) {
        // Abandoned fires: a previous user message saw these pending,
        // no assistant ever followed, and now another user message
        // arrives. Drop them as an orphan trail before the new turn.
        flushPendingAsTrail();
      } else {
        // Normal flow: lifecycle events fire BEFORE the user message of
        // their turn. Carry across this user — the next assistant will
        // collect them.
        userSeenSincePending = true;
      }
    }
    out.push(m);
  }
  flushPendingAsTrail();
  return out;
}
