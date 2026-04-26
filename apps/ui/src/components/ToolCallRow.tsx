import { useRef, useState } from "react";
import type { ToolCall } from "@/lib/types";
import { KNOWN_TOOLS } from "./EventEditorConstants";
import { Popover } from "./ui";

export default function ToolCallRow({
  tc,
  index,
  readOnly,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: {
  tc: ToolCall;
  index: number;
  readOnly: boolean;
  onChange: (index: number, updated: ToolCall) => void;
  onRemove: (index: number) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [argsText, setArgsText] = useState(() => JSON.stringify(tc.args, null, 2));
  const [argsError, setArgsError] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = KNOWN_TOOLS.filter((t) => t.startsWith(tc.tool) && t !== tc.tool);

  const handleToolChange = (val: string) => {
    setShowSuggestions(true);
    onChange(index, { ...tc, tool: val });
  };

  const handleArgChange = (val: string) => {
    setArgsText(val);
    try {
      const parsed = JSON.parse(val);
      setArgsError(null);
      onChange(index, { ...tc, args: parsed as Record<string, unknown> });
    } catch {
      setArgsError("Invalid JSON");
    }
  };

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: "10px 12px",
        marginBottom: 6,
        background: "var(--bg-surface)",
      }}
    >
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: "var(--text-muted)",
            minWidth: 14,
            textAlign: "right",
          }}
        >
          {index + 1}
        </span>
        <div style={{ flex: 1 }}>
          <Popover
            open={!readOnly && showSuggestions && filtered.length > 0}
            onOpenChange={setShowSuggestions}
            placement="bottom-start"
            trigger={
              <input
                ref={inputRef}
                className="agent-settings-input"
                type="text"
                placeholder="tool name"
                value={tc.tool}
                readOnly={readOnly}
                disabled={readOnly}
                style={{ width: "100%", fontFamily: "var(--font-sans)", fontSize: 12 }}
                onChange={(e) => handleToolChange(e.target.value)}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              />
            }
          >
            {filtered.map((t) => (
              <button
                key={t}
                type="button"
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "6px 10px",
                  fontSize: 12,
                  fontFamily: "var(--font-sans)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-primary)",
                }}
                onMouseDown={() => {
                  onChange(index, { ...tc, tool: t });
                  setShowSuggestions(false);
                }}
              >
                {t}
              </button>
            ))}
          </Popover>
        </div>
        {!readOnly && (
          <div style={{ display: "flex", gap: 2 }}>
            <button
              type="button"
              title="Move up"
              disabled={isFirst}
              style={{
                background: "none",
                border: "1px solid var(--border)",
                borderRadius: 4,
                cursor: isFirst ? "not-allowed" : "pointer",
                padding: "2px 6px",
                fontSize: 11,
                opacity: isFirst ? 0.35 : 1,
                color: "var(--text-muted)",
              }}
              onClick={() => onMoveUp(index)}
            >
              ↑
            </button>
            <button
              type="button"
              title="Move down"
              disabled={isLast}
              style={{
                background: "none",
                border: "1px solid var(--border)",
                borderRadius: 4,
                cursor: isLast ? "not-allowed" : "pointer",
                padding: "2px 6px",
                fontSize: 11,
                opacity: isLast ? 0.35 : 1,
                color: "var(--text-muted)",
              }}
              onClick={() => onMoveDown(index)}
            >
              ↓
            </button>
            <button
              type="button"
              title="Remove"
              style={{
                background: "none",
                border: "1px solid var(--border)",
                borderRadius: 4,
                cursor: "pointer",
                padding: "2px 6px",
                fontSize: 11,
                color: "var(--text-muted)",
              }}
              onClick={() => onRemove(index)}
            >
              ×
            </button>
          </div>
        )}
      </div>
      <textarea
        className="agent-settings-input"
        placeholder={readOnly ? "(no args)" : '{"key": "value"}'}
        value={argsText}
        readOnly={readOnly}
        disabled={readOnly}
        rows={3}
        style={{
          width: "100%",
          fontFamily: "var(--font-sans)",
          fontSize: 11,
          resize: "vertical",
          minHeight: 56,
        }}
        onChange={(e) => handleArgChange(e.target.value)}
      />
      {argsError && (
        <div style={{ fontSize: 11, color: "var(--error)", marginTop: 2 }}>{argsError}</div>
      )}
    </div>
  );
}
