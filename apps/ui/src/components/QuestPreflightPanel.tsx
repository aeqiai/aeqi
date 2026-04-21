import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

interface PreflightResult {
  system: string;
  tools: { allow: string[]; deny: string[] };
}

interface Props {
  agentId: string;
  description: string;
  taskIdeaIds?: string[];
}

const DEBOUNCE_MS = 400;

export default function QuestPreflightPanel({ agentId, description, taskIdeaIds = [] }: Props) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<number | null>(null);
  const lastKeyRef = useRef("");

  useEffect(() => {
    if (!open) return;
    const key = `${agentId}|${description}|${taskIdeaIds.join(",")}`;
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;

    if (timerRef.current) clearTimeout(timerRef.current);

    if (!agentId || !description.trim()) {
      setResult(null);
      return;
    }

    setLoading(true);
    timerRef.current = window.setTimeout(async () => {
      try {
        const res = await api.questPreflight({
          agent_id: agentId,
          description,
          task_idea_ids: taskIdeaIds,
        });
        if (res.ok) {
          setResult({ system: res.system, tools: res.tools });
        } else {
          setResult(null);
        }
      } catch {
        setResult(null);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [open, agentId, description, taskIdeaIds]);

  // Reset cached key when panel closes so it re-fetches on reopen.
  useEffect(() => {
    if (!open) lastKeyRef.current = "";
  }, [open]);

  const charCount = result?.system.length ?? 0;
  const hasTools = result && (result.tools.allow.length > 0 || result.tools.deny.length > 0);

  return (
    <div
      style={{
        marginTop: 4,
        borderTop: open ? "1px solid var(--border)" : "none",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          padding: "6px 0",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--text-muted)",
          fontFamily: "var(--font-sans)",
          fontSize: "var(--font-size-xs)",
          textAlign: "left",
        }}
      >
        <span
          style={{
            display: "inline-block",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 150ms ease",
            fontSize: 10,
          }}
        >
          ▶
        </span>
        Preview assembled context
        {loading && (
          <span style={{ marginLeft: 4, opacity: 0.5, fontStyle: "italic" }}>loading…</span>
        )}
      </button>

      {open && (
        <div style={{ paddingBottom: 8 }}>
          {!agentId || !description.trim() ? (
            <p
              style={{
                margin: 0,
                fontSize: "var(--font-size-xs)",
                color: "var(--text-muted)",
                fontStyle: "italic",
              }}
            >
              No context configured — plain user-prompt run
            </p>
          ) : result ? (
            <>
              {result.system ? (
                <>
                  <div
                    style={{
                      fontSize: "var(--font-size-micro)",
                      fontWeight: 600,
                      color: "var(--section-label-color)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      marginBottom: 4,
                      display: "flex",
                      justifyContent: "space-between",
                    }}
                  >
                    <span>Assembled context</span>
                    <span style={{ fontWeight: 400 }}>{charCount.toLocaleString()} chars</span>
                  </div>
                  <pre
                    style={{
                      margin: "0 0 8px",
                      padding: "8px 10px",
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-md)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--font-size-xs)",
                      color: "var(--text-secondary)",
                      lineHeight: 1.5,
                      maxHeight: 200,
                      overflowY: "auto",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {result.system}
                  </pre>
                </>
              ) : (
                <p
                  style={{
                    margin: "0 0 8px",
                    fontSize: "var(--font-size-xs)",
                    color: "var(--text-muted)",
                    fontStyle: "italic",
                  }}
                >
                  No context configured — plain user-prompt run
                </p>
              )}

              {hasTools && (
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {result.tools.allow.length > 0 && (
                    <ChipRow label="Allow" chips={result.tools.allow} color="var(--success)" />
                  )}
                  {result.tools.deny.length > 0 && (
                    <ChipRow label="Deny" chips={result.tools.deny} color="var(--error)" />
                  )}
                </div>
              )}
            </>
          ) : !loading ? (
            <p
              style={{
                margin: 0,
                fontSize: "var(--font-size-xs)",
                color: "var(--text-muted)",
                fontStyle: "italic",
              }}
            >
              No context configured — plain user-prompt run
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ChipRow({ label, chips, color }: { label: string; chips: string[]; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <span
        style={{
          fontSize: "var(--font-size-micro)",
          fontWeight: 600,
          color: "var(--section-label-color)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          minWidth: 36,
        }}
      >
        {label}
      </span>
      {chips.map((c) => (
        <span
          key={c}
          style={{
            fontSize: "var(--font-size-xs)",
            fontFamily: "var(--font-mono)",
            padding: "1px 6px",
            borderRadius: "var(--key-pill-radius)",
            background: "var(--key-pill-bg)",
            border: `1px solid var(--key-pill-border)`,
            color,
          }}
        >
          {c}
        </span>
      ))}
    </div>
  );
}
