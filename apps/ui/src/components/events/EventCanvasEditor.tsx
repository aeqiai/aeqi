import { useId, useState } from "react";
import type { ToolCall } from "@/lib/types";
import { Popover, Textarea } from "../ui";
import { COMMON_PATTERNS, KNOWN_TOOLS } from "../EventEditorConstants";
import { lifecycleGroup } from "./lifecycle";

/**
 * Canvas-as-editor. Each node is the editor for its own slice:
 *   trigger    → pattern + cooldown
 *   tool[i]    → tool name + JSON args + ↑↓✕
 *   fires      → click opens the FiresPanel via `onShowFires`
 *
 * No separate form below. State lives in the parent (EventDetail) which
 * holds the dirty draft and the Save button. This component is dumb:
 * receives the draft and a single `onChange` patcher.
 */

export interface CanvasDraft {
  pattern: string;
  cooldown_secs: number;
  tool_calls: ToolCall[];
}

interface EventCanvasEditorProps {
  draft: CanvasDraft;
  readOnly?: boolean;
  hasFired: boolean;
  fireCount: number;
  lastFired: string | null;
  totalCostUsd: number;
  onChange: (patch: Partial<CanvasDraft>) => void;
  onShowFires: () => void;
  firesOpen: boolean;
}

type Tone = "runtime" | "context" | "webhooks" | "routines" | "tool" | "fired" | "empty";

function patternTone(pattern: string): Tone {
  return lifecycleGroup(pattern);
}

function prettyToolName(name: string): { scope: string; action: string | null } {
  const dot = name.indexOf(".");
  if (dot === -1) return { scope: name, action: null };
  return { scope: name.slice(0, dot), action: name.slice(dot + 1) };
}

function toolArgPreview(tc: ToolCall): string | null {
  const keys = Object.keys(tc.args ?? {});
  if (keys.length === 0) return null;
  const first = keys[0];
  const val = (tc.args as Record<string, unknown>)[first];
  const preview =
    typeof val === "string"
      ? `"${val.length > 24 ? val.slice(0, 24) + "…" : val}"`
      : typeof val === "number" || typeof val === "boolean"
        ? String(val)
        : Array.isArray(val)
          ? `[${val.length}]`
          : "…";
  return `${first} ${preview}`;
}

export default function EventCanvasEditor({
  draft,
  readOnly = false,
  hasFired,
  fireCount,
  lastFired,
  totalCostUsd,
  onChange,
  onShowFires,
  firesOpen,
}: EventCanvasEditorProps) {
  const tone = patternTone(draft.pattern);
  const tools = draft.tool_calls;

  const insertStep = (at: number) => {
    if (readOnly) return;
    const next = [...tools];
    next.splice(at, 0, { tool: "", args: {} });
    onChange({ tool_calls: next });
  };

  const removeStep = (i: number) => {
    if (readOnly) return;
    onChange({ tool_calls: tools.filter((_, j) => j !== i) });
  };

  const moveStep = (i: number, dir: -1 | 1) => {
    if (readOnly) return;
    const j = i + dir;
    if (j < 0 || j >= tools.length) return;
    const next = [...tools];
    [next[i], next[j]] = [next[j], next[i]];
    onChange({ tool_calls: next });
  };

  const updateStep = (i: number, patch: Partial<ToolCall>) => {
    if (readOnly) return;
    onChange({
      tool_calls: tools.map((tc, j) => (j === i ? { ...tc, ...patch } : tc)),
    });
  };

  return (
    <div className="event-canvas event-canvas--editor" role="group" aria-label="Event pipeline">
      <div className="event-canvas-track">
        <TriggerNode
          tone={tone}
          pattern={draft.pattern}
          cooldown={draft.cooldown_secs}
          readOnly={readOnly}
          onPattern={(v) => onChange({ pattern: v })}
          onCooldown={(v) => onChange({ cooldown_secs: v })}
        />

        <Inserter onInsert={() => insertStep(0)} disabled={readOnly} />

        {tools.length === 0 ? (
          <EmptyToolNode onAdd={() => insertStep(0)} disabled={readOnly} />
        ) : (
          tools.map((tc, i) => (
            <span key={i} className="event-canvas-chain-step">
              <ToolNode
                index={i}
                total={tools.length}
                tc={tc}
                readOnly={readOnly}
                onChange={(patch) => updateStep(i, patch)}
                onMoveUp={() => moveStep(i, -1)}
                onMoveDown={() => moveStep(i, 1)}
                onRemove={() => removeStep(i)}
              />
              <Inserter onInsert={() => insertStep(i + 1)} disabled={readOnly} />
            </span>
          ))
        )}

        <TerminalNode
          hasFired={hasFired}
          fireCount={fireCount}
          lastFired={lastFired}
          totalCostUsd={totalCostUsd}
          open={firesOpen}
          onClick={onShowFires}
        />
      </div>
    </div>
  );
}

/* ── Trigger node + popover ────────────────────────────────────────── */

function TriggerNode({
  tone,
  pattern,
  cooldown,
  readOnly,
  onPattern,
  onCooldown,
}: {
  tone: Tone;
  pattern: string;
  cooldown: number;
  readOnly: boolean;
  onPattern: (v: string) => void;
  onCooldown: (v: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-start"
      trigger={
        <button
          type="button"
          className={`event-canvas-node event-canvas-node--trigger event-canvas-node--tone-${tone} event-canvas-node--editable`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={id}
          disabled={readOnly}
        >
          <span className="event-canvas-node-label">trigger</span>
          <span className="event-canvas-node-body">
            <span className="event-canvas-node-mono">{pattern || "(none)"}</span>
            {cooldown > 0 && <span className="event-canvas-node-meta">cooldown {cooldown}s</span>}
          </span>
        </button>
      }
    >
      <div id={id} className="events-node-popover" role="dialog" aria-label="Edit trigger">
        <label className="events-node-popover-label" htmlFor={`${id}-pattern`}>
          pattern
        </label>
        <input
          id={`${id}-pattern`}
          className="agent-settings-input events-node-popover-input"
          type="text"
          placeholder="session:start"
          value={pattern}
          onChange={(e) => onPattern(e.target.value)}
        />
        <div className="events-node-popover-suggestions">
          {COMMON_PATTERNS.map((p) => (
            <button
              key={p}
              type="button"
              className={`events-node-popover-suggestion${p === pattern ? " active" : ""}`}
              onClick={() => onPattern(p)}
            >
              {p}
            </button>
          ))}
        </div>
        <label className="events-node-popover-label" htmlFor={`${id}-cool`}>
          cooldown (s)
        </label>
        <input
          id={`${id}-cool`}
          className="agent-settings-input events-node-popover-input"
          type="number"
          min={0}
          value={cooldown}
          onChange={(e) => onCooldown(parseInt(e.target.value, 10) || 0)}
        />
      </div>
    </Popover>
  );
}

/* ── Tool node + popover ───────────────────────────────────────────── */

function ToolNode({
  index,
  total,
  tc,
  readOnly,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  index: number;
  total: number;
  tc: ToolCall;
  readOnly: boolean;
  onChange: (patch: Partial<ToolCall>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const { scope, action } = prettyToolName(tc.tool || "(unset)");
  const preview = toolArgPreview(tc);
  const [argsText, setArgsText] = useState(() => JSON.stringify(tc.args, null, 2));
  const [argsError, setArgsError] = useState<string | null>(null);

  const handleArgs = (val: string) => {
    setArgsText(val);
    try {
      const parsed = JSON.parse(val);
      setArgsError(null);
      onChange({ args: parsed as Record<string, unknown> });
    } catch {
      setArgsError("invalid JSON");
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setArgsText(JSON.stringify(tc.args, null, 2));
        setOpen(next);
      }}
      placement="bottom-start"
      trigger={
        <button
          type="button"
          className="event-canvas-node event-canvas-node--tool event-canvas-node--tone-tool event-canvas-node--editable"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={id}
          disabled={readOnly}
        >
          <span className="event-canvas-node-label">step {index + 1}</span>
          <span className="event-canvas-node-body">
            <span className="event-canvas-node-title">
              <span className="event-canvas-tool-scope">{scope}</span>
              {action && <span className="event-canvas-tool-action">.{action}</span>}
            </span>
            {preview && <span className="event-canvas-node-mono">{preview}</span>}
          </span>
        </button>
      }
    >
      <div
        id={id}
        className="events-node-popover"
        role="dialog"
        aria-label={`Edit step ${index + 1}`}
      >
        <label className="events-node-popover-label" htmlFor={`${id}-tool`}>
          tool
        </label>
        <input
          id={`${id}-tool`}
          className="agent-settings-input events-node-popover-input"
          type="text"
          list={`${id}-tools`}
          placeholder="ideas.search"
          value={tc.tool}
          onChange={(e) => onChange({ tool: e.target.value })}
        />
        <datalist id={`${id}-tools`}>
          {KNOWN_TOOLS.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <label className="events-node-popover-label" htmlFor={`${id}-args`}>
          args (JSON)
        </label>
        <Textarea
          bare
          id={`${id}-args`}
          className="agent-settings-input events-node-popover-textarea"
          rows={5}
          value={argsText}
          onChange={(e) => handleArgs(e.target.value)}
        />
        {argsError && <div className="events-node-popover-error">{argsError}</div>}
        <div className="events-node-popover-actions">
          <button
            type="button"
            className="events-node-popover-act"
            onClick={onMoveUp}
            disabled={index === 0}
            title="Move up"
          >
            ↑
          </button>
          <button
            type="button"
            className="events-node-popover-act"
            onClick={onMoveDown}
            disabled={index === total - 1}
            title="Move down"
          >
            ↓
          </button>
          <span className="events-node-popover-spacer" />
          <button
            type="button"
            className="events-node-popover-act events-node-popover-act--danger"
            onClick={() => {
              onRemove();
              setOpen(false);
            }}
            title="Remove step"
          >
            remove
          </button>
        </div>
      </div>
    </Popover>
  );
}

/* ── Inserter (the "+" between nodes) ──────────────────────────────── */

function Inserter({ onInsert, disabled }: { onInsert: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      className="event-canvas-inserter"
      onClick={onInsert}
      disabled={disabled}
      title="Insert step"
      aria-label="Insert step"
    >
      <svg width="40" height="12" viewBox="0 0 40 12" aria-hidden>
        <line
          x1="0"
          y1="6"
          x2="34"
          y2="6"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
        />
        <path
          d="M30 2 L36 6 L30 10"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinejoin="round"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      <span className="event-canvas-inserter-plus" aria-hidden>
        +
      </span>
    </button>
  );
}

/* ── Empty tool node placeholder ───────────────────────────────────── */

function EmptyToolNode({ onAdd, disabled }: { onAdd: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      className="event-canvas-node event-canvas-node--tool event-canvas-node--tone-empty event-canvas-node--editable"
      onClick={onAdd}
      disabled={disabled}
    >
      <span className="event-canvas-node-label">tools</span>
      <span className="event-canvas-node-body">
        <span className="event-canvas-node-title event-canvas-node-empty">add a step</span>
        <span className="event-canvas-node-meta">click to wire a tool</span>
      </span>
    </button>
  );
}

/* ── Terminal "fires" node ─────────────────────────────────────────── */

function TerminalNode({
  hasFired,
  fireCount,
  lastFired,
  totalCostUsd,
  open,
  onClick,
}: {
  hasFired: boolean;
  fireCount: number;
  lastFired: string | null;
  totalCostUsd: number;
  open: boolean;
  onClick: () => void;
}) {
  const tone: Tone = hasFired ? "fired" : "empty";
  return (
    <button
      type="button"
      className={`event-canvas-node event-canvas-node--terminal event-canvas-node--tone-${tone} event-canvas-node--editable${open ? " is-open" : ""}`}
      onClick={onClick}
      aria-pressed={open}
    >
      <span className="event-canvas-node-label">fires</span>
      <span className="event-canvas-node-body">
        {hasFired ? (
          <>
            <span className="event-canvas-node-title">{fireCount.toLocaleString()}×</span>
            {lastFired && (
              <span className="event-canvas-node-meta">
                last {new Date(lastFired).toLocaleString()}
              </span>
            )}
            {totalCostUsd > 0 && (
              <span className="event-canvas-node-meta">${totalCostUsd.toFixed(4)} total</span>
            )}
          </>
        ) : (
          <span className="event-canvas-node-title event-canvas-node-empty">never fired</span>
        )}
      </span>
    </button>
  );
}
