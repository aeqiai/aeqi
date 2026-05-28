import { useId, useMemo, useState } from "react";
import { useNav } from "@/hooks/useNav";
import { useAgentIdeas } from "@/queries/ideas";
import { RichMarkdown, buildIdeasByName } from "@/components/markdown/RichMarkdown";
import {
  type Message,
  type MessageSegment,
  type ToolEvent,
  type FileChangedEvent,
  type FileDeletedEvent,
  type ToolSummarizedEvent,
  type EventFire,
  type EntityRef,
  formatMs,
  formatTime,
  toolLabel,
  shouldRenderStatus,
} from "./types";
import EntityRefInline from "./EntityRefInline";
import type { ScopeValue } from "@/lib/types";
import { SCOPE_LABEL } from "../ideas/types";

// ── Markdown wrapper ─────────────────────────────────────────────────────

export function SessionMarkdown({ body }: { body: string }) {
  const { trustId } = useNav();
  const { data: ideas } = useAgentIdeas(trustId, true, trustId);
  const ideasByName = useMemo(() => buildIdeasByName(ideas), [ideas]);
  return <RichMarkdown body={body} variant="session" ideasByName={ideasByName} agentId={trustId} />;
}

// ── Inline group: text + entity_ref runs ────────────────────────────────

type InlinePart = { kind: "text"; text: string } | { kind: "entity_ref"; ref: EntityRef };

/**
 * Renders a contiguous run of text + entity_ref parts. Text-only runs
 * defer to markdown so tables / lists / code fences keep working; mixed
 * runs render as plain inline elements (entity refs are link primitives).
 */
function InlineGroup({ parts }: { parts: InlinePart[] }) {
  const allText = parts.every((p) => p.kind === "text");
  if (allText) {
    const body = parts
      .filter((p): p is { kind: "text"; text: string } => p.kind === "text")
      .map((p) => p.text)
      .join("");
    if (!body.trim()) return null;
    return (
      <div className="asv-msg-content">
        <SessionMarkdown body={body} />
      </div>
    );
  }
  return (
    <div className="asv-msg-content">
      {parts.map((p, i) =>
        p.kind === "text" ? <span key={i}>{p.text}</span> : <EntityRefInline key={i} ref={p.ref} />,
      )}
    </div>
  );
}

// ── Tool block ──────────────────────────────────────────────────────────

function ExpandableOutput({ text, limit = 100 }: { text: string; limit?: number }) {
  const [expanded, setExpanded] = useState(false);
  const needsExpand = text.length > limit;
  return (
    <div className="session-tool-output">
      {expanded || !needsExpand ? text : text.slice(0, limit) + "..."}
      {needsExpand && (
        <button
          type="button"
          className="session-tool-expand"
          aria-expanded={expanded}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
        >
          {expanded ? "less" : "more"}
        </button>
      )}
    </div>
  );
}

const TOOL_CATEGORY_PREFIXES: Array<[string, string]> = [
  ["agents_", "agents"],
  ["quests_", "quests"],
  ["events_", "events"],
  ["ideas_", "ideas"],
  ["prompts_", "prompts"],
  ["web_", "web"],
];

function toolCategory(name: string): string {
  for (const [prefix, category] of TOOL_CATEGORY_PREFIXES) {
    if (name.startsWith(prefix)) return category;
  }
  return "system";
}

function ToolBlock({ items, live = false }: { items: MessageSegment[]; live?: boolean }) {
  const [expanded, setExpanded] = useState(live);
  const detailId = useId();
  const tools = items.filter((s): s is { kind: "tool"; event: ToolEvent } => s.kind === "tool");
  const cats = [...new Set(tools.map((t) => toolCategory(t.event.name)))];
  const hasFail = tools.some((t) => t.event.success === false);
  const showDetail = live || expanded;
  const count = tools.length;

  return (
    <div
      className={`asv-tools-group${live ? " asv-tools-group--live" : ""}${hasFail ? " asv-tools-group--fail" : ""}`}
    >
      {!live && (
        <button
          type="button"
          className="asv-tools-toggle"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls={detailId}
        >
          <span className="asv-tools-chevron">{expanded ? "▾" : "▸"}</span>
          <span className="asv-tools-count">
            {count} tool{count !== 1 ? "s" : ""}
          </span>
          {!expanded && cats.length > 0 && (
            <span className="asv-tools-cats">{cats.join(", ")}</span>
          )}
        </button>
      )}
      {showDetail && (
        <div id={detailId} className="asv-tools-detail">
          {items.map((seg, si) =>
            seg.kind === "tool" ? (
              <div key={si} className={`asv-tool-row${seg.event.success === false ? " fail" : ""}`}>
                <span className={`asv-tool-dot ${seg.event.type}`} />
                <span className="asv-tool-name">{toolLabel(seg.event.name)}</span>
                {seg.event.duration_ms != null && (
                  <span className="asv-tool-dur">{formatMs(seg.event.duration_ms)}</span>
                )}
                {!live && seg.event.output_preview && (
                  <ExpandableOutput text={seg.event.output_preview} />
                )}
              </div>
            ) : seg.kind === "status" ? (
              <div key={si} className="asv-tool-status-msg">
                {seg.text}
              </div>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}

// ── File + tool-summary chips ───────────────────────────────────────────

function shortPath(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || p;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function FileChangedChip({ event }: { event: FileChangedEvent }) {
  const isCreated = event.operation === "created";
  return (
    <div className={`asv-file-chip asv-file-chip--${isCreated ? "created" : "modified"}`}>
      <span className="asv-file-chip-dot" aria-hidden="true" />
      <span className="asv-file-chip-op">{isCreated ? "wrote" : "edited"}</span>
      <span className="asv-file-chip-path" title={event.path}>
        {shortPath(event.path)}
      </span>
      <span className="asv-file-chip-size">({formatBytes(event.bytes)})</span>
    </div>
  );
}

function FileDeletedChip({ event }: { event: FileDeletedEvent }) {
  return (
    <div className="asv-file-chip asv-file-chip--deleted">
      <span className="asv-file-chip-dot" aria-hidden="true" />
      <span className="asv-file-chip-op">deleted</span>
      <span className="asv-file-chip-path" title={event.path}>
        {shortPath(event.path)}
      </span>
    </div>
  );
}

function ToolSummarizedChip({ event }: { event: ToolSummarizedEvent }) {
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  return (
    <div className="asv-tool-summarized-chip">
      <button
        type="button"
        className="asv-tool-summarized-header"
        onClick={() => setExpanded((e) => !e)}
        title={expanded ? "Hide summary" : "Show summary"}
        aria-expanded={expanded}
        aria-controls={bodyId}
      >
        <span className="asv-tool-summarized-dot" aria-hidden="true" />
        <span className="asv-tool-summarized-name">{event.tool_name}</span>
        <span className="asv-tool-summarized-label">summarized</span>
        <span className="asv-tool-summarized-size">({formatBytes(event.original_bytes)})</span>
        <span className="asv-tool-summarized-chevron">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && event.summary && (
        <div id={bodyId} className="asv-tool-summarized-body">
          {event.summary}
        </div>
      )}
    </div>
  );
}

// ── Event-fire item — exported for direct use by event_fire role messages ──

export function EventFireItem({ msg }: { msg: Message }) {
  const { goEntity, trustId } = useNav();
  const fire = msg.eventFire;
  if (!fire) return null;

  return (
    <div className="asv-event-fire">
      <button
        type="button"
        className="asv-event-fire-name"
        onClick={() => trustId && goEntity(trustId, "events", fire.eventId)}
        title={fire.pattern}
      >
        {fire.eventName || fire.pattern || "event"}
      </button>
      {fire.scope && fire.scope !== "self" && (
        <span className="asv-event-fire-scope">{`(${
          SCOPE_LABEL[fire.scope as ScopeValue] ?? fire.scope
        })`}</span>
      )}
      {msg.timestamp && <span className="asv-event-fire-time">{formatTime(msg.timestamp)}</span>}
    </div>
  );
}

// ── Segment renderer ────────────────────────────────────────────────────

type SegGroup =
  | { kind: "inline"; parts: InlinePart[] }
  | { kind: "step"; step: number }
  | { kind: "status"; text: string }
  | { kind: "event_fire"; fire: EventFire }
  | { kind: "tools"; items: MessageSegment[] }
  | { kind: "file_changed"; event: FileChangedEvent }
  | { kind: "file_deleted"; event: FileDeletedEvent }
  | { kind: "tool_summarized"; event: ToolSummarizedEvent };

function buildGroups(segments: MessageSegment[]): SegGroup[] {
  const groups: SegGroup[] = [];

  const pushInline = (part: InlinePart) => {
    const last = groups[groups.length - 1];
    if (last && last.kind === "inline") {
      last.parts.push(part);
    } else {
      groups.push({ kind: "inline", parts: [part] });
    }
  };

  for (const seg of segments) {
    if (seg.kind === "text") {
      pushInline({ kind: "text", text: seg.text });
    } else if (seg.kind === "entity_ref") {
      pushInline({ kind: "entity_ref", ref: seg.ref });
    } else if (seg.kind === "step") {
      groups.push({ kind: "step", step: seg.step });
    } else if (seg.kind === "status") {
      const stepMatch = seg.text.trim().match(/^step\s+(\d+)$/i);
      if (stepMatch) {
        groups.push({ kind: "step", step: Number(stepMatch[1]) });
      } else if (shouldRenderStatus(seg.text)) {
        groups.push({ kind: "status", text: seg.text });
      }
    } else if (seg.kind === "event_fire") {
      groups.push({ kind: "event_fire", fire: seg.fire });
    } else if (seg.kind === "file_changed") {
      groups.push({ kind: "file_changed", event: seg.event });
    } else if (seg.kind === "file_deleted") {
      groups.push({ kind: "file_deleted", event: seg.event });
    } else if (seg.kind === "tool_summarized") {
      groups.push({ kind: "tool_summarized", event: seg.event });
    } else {
      const last = groups[groups.length - 1];
      if (last && last.kind === "tools") {
        last.items.push(seg);
      } else {
        groups.push({ kind: "tools", items: [seg] });
      }
    }
  }
  return groups;
}

/**
 * Drop step headers with no visible content following them. The runtime
 * fires `session:step_start` on every model iteration, including iterations
 * that produce no UI output, so the raw segment list contains empty steps.
 * Single backward pass — keeps a step only if real content followed it.
 */
function dropEmptySteps(groups: SegGroup[]): SegGroup[] {
  const out: SegGroup[] = [];
  let seenContentSinceStep = false;
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (g.kind === "step") {
      if (seenContentSinceStep) out.push(g);
      seenContentSinceStep = false;
      continue;
    }
    if (g.kind !== "inline" || !g.parts.every((p) => p.kind === "text" && !p.text.trim())) {
      seenContentSinceStep = true;
    }
    out.push(g);
  }
  return out.reverse();
}

/** Renders segments, grouping consecutive tools into blocks and dropping empty steps. */
export function SegmentRenderer({
  segments,
  live = false,
}: {
  segments: MessageSegment[];
  live?: boolean;
}) {
  const groups = useMemo(() => dropEmptySteps(buildGroups(segments)), [segments]);

  return (
    <>
      {groups.map((group, gi) => {
        switch (group.kind) {
          case "inline":
            return <InlineGroup key={gi} parts={group.parts} />;
          case "step":
            return (
              <div key={gi} className="asv-step-sep">
                <span>{`Step ${group.step}`}</span>
              </div>
            );
          case "status":
            return (
              <div key={gi} className="asv-status-line">
                {group.text}
              </div>
            );
          case "event_fire":
            return (
              <EventFireItem
                key={gi}
                msg={{ role: "event_fire", content: "", eventFire: group.fire }}
              />
            );
          case "file_changed":
            return <FileChangedChip key={gi} event={group.event} />;
          case "file_deleted":
            return <FileDeletedChip key={gi} event={group.event} />;
          case "tool_summarized":
            return <ToolSummarizedChip key={gi} event={group.event} />;
          case "tools":
            return <ToolBlock key={gi} items={group.items} live={live} />;
        }
      })}
    </>
  );
}
