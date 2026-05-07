import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { sessionDeepUrl } from "@/lib/sessionUrl";
import { useNavigate } from "react-router-dom";
import InboxComposer from "./InboxComposer";
import type { InboxRow } from "./types";

export interface InboxDetailProps {
  row: InboxRow | null;
  onAnswer: (sessionId: string, answer: string) => Promise<{ ok: boolean; error?: string }>;
  onDismiss: (sessionId: string) => Promise<{ ok: boolean; error?: string }>;
  onBack: () => void;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
}

interface SimpleMessage {
  role: string;
  content: string;
  timestamp: number;
}

function parseMessages(raw: Record<string, unknown>): SimpleMessage[] {
  const items = Array.isArray(raw.messages) ? (raw.messages as Record<string, unknown>[]) : [];
  const result: SimpleMessage[] = [];
  for (const m of items) {
    const role = typeof m.role === "string" ? m.role.toLowerCase() : "";
    if (role !== "user" && role !== "assistant") continue;
    const content = typeof m.content === "string" ? m.content : "";
    if (!content.trim()) continue;
    const ts = m.created_at ? new Date(String(m.created_at)).getTime() : Date.now();
    result.push({ role, content, timestamp: ts });
  }
  return result;
}

export default function InboxDetail({
  row,
  onAnswer,
  onDismiss,
  onBack,
  composerRef,
}: InboxDetailProps) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<SimpleMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async (sessionId: string) => {
    setLoading(true);
    try {
      const raw = await api.getSessionMessages(sessionId, 10);
      setMessages(parseMessages(raw));
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const rowId = row?.id ?? null;
  useEffect(() => {
    if (!rowId) {
      setMessages([]);
      return;
    }
    void loadMessages(rowId);
  }, [rowId, loadMessages]);

  // Scroll thread to bottom when messages update
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  if (!row) {
    return (
      <div className="inbox-detail inbox-detail--empty">
        <span className="inbox-detail-placeholder">Nothing selected.</span>
      </div>
    );
  }

  const deepUrl = sessionDeepUrl(row.entity_id, row.agent_id, row.id);

  return (
    <div className="inbox-detail">
      {/* Header */}
      <div className="inbox-detail-header">
        <div className="inbox-detail-header-from">
          {/* Back button — mobile only (<900px), returns to list view */}
          <button
            type="button"
            className="inbox-detail-back"
            onClick={onBack}
            aria-label="Back to inbox list"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M7.5 2L3 6l4.5 4" />
            </svg>
          </button>
          <span className="inbox-detail-header-agent">{row.from.name}</span>
          {row.entity_id && (
            <span className="inbox-detail-header-sep" aria-hidden>
              ·
            </span>
          )}
        </div>
        <button
          type="button"
          className="inbox-detail-header-open"
          onClick={() => navigate(deepUrl)}
          title="Open full session"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M2 10 L10 2M6 2h4v4" />
          </svg>
          Open
        </button>
      </div>

      {/* Decision-request urgency tag — quiet accent strip above subject */}
      {row.kind === "decision_request" && (
        <div className="inbox-detail-decision-tag" aria-label="Awaiting your decision">
          Awaiting your decision
        </div>
      )}

      {/* Subject / question */}
      <div className="inbox-detail-subject">{row.subject}</div>

      {/* Thread context — last ~10 messages */}
      <div className="inbox-detail-thread" ref={scrollRef}>
        {loading && <div className="inbox-detail-loading">Loading context…</div>}
        {!loading && messages.length === 0 && (
          <div className="inbox-detail-no-context">No prior messages.</div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`inbox-thread-msg inbox-thread-msg--${msg.role}`}>
            <span className="inbox-thread-msg-role">
              {msg.role === "user" ? "You" : row.from.name}
            </span>
            <p className="inbox-thread-msg-content">{msg.content}</p>
          </div>
        ))}
      </div>

      {/* Composer — only when item is replyable */}
      {row.replyable && (
        <InboxComposer
          sessionId={row.id}
          agentName={row.from.name}
          onSend={onAnswer}
          onDismiss={onDismiss}
          composerRef={composerRef}
        />
      )}
    </div>
  );
}
