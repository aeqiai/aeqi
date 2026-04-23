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

/**
 * Hook that returns a stable `processRawMessages` callback.
 * Converts raw API message records into the structured `Message[]` format
 * used by the chat UI.
 */
export function useMessageProcessor() {
  return useCallback((rawMessages: Array<Record<string, unknown>>): Message[] => {
    const processed: Message[] = [];
    let pendingTools: MessageSegment[] = [];
    let currentAgent: Message | null = null;
    let stepCount = 0;
    let sawStoredStepMarkers = false;

    const flushAgent = () => {
      if (currentAgent) {
        if (!currentAgent.stepCount) {
          currentAgent.stepCount = countStepSegments(currentAgent.segments);
        }
        processed.push(currentAgent);
        currentAgent = null;
      }
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
 * Trailing fires (no following assistant — e.g. async events fired after
 * the last response) are coalesced into a single trail-only assistant
 * message so they render as their own collapsed grey row.
 */
function foldEventFiresIntoTrails(messages: Message[]): Message[] {
  const out: Message[] = [];
  let pending: { fire: EventFire; ts: number }[] = [];

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
    }
    out.push(m);
  }
  flushPendingAsTrail();
  return out;
}
