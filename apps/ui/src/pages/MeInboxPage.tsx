import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageCircleQuestion } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { sessionDeepUrlFromId } from "@/lib/sessionUrl";
import { useAuthStore } from "@/store/auth";
import { useInboxStore, probeDismissEndpoint } from "@/store/inbox";
import { useDaemonStore } from "@/store/daemon";
import InboxToolbar from "@/components/inbox/InboxToolbar";
import SessionRail, { type SessionRailRow } from "@/components/sessions/SessionRail";
import SessionDetail from "@/components/sessions/SessionDetail";
import StreamingMessage from "@/components/session/StreamingMessage";
import { useWebSocketChat } from "@/components/session/useWebSocketChat";
import { Badge, IconButton, Loading, Tooltip } from "@/components/ui";
import { toInboxRow, DEFAULT_FILTER } from "@/components/inbox/types";
import type { InboxFilterState, InboxRow, InboxSort } from "@/components/inbox/types";
import type { Message, SessionInfo } from "@/components/session/types";
import { recencyBucket, timeShort } from "@/lib/format";

const KIND_LABEL: Record<string, string> = {
  decision_request: "Decision requests",
  system: "System",
};

interface RawApiMessage {
  role?: string;
  content?: string;
  created_at?: string;
  from_kind?: string | null;
  from_id?: string | null;
}

/**
 * Map the inbox API's raw message shape to the canonical session `Message`
 * type so the SessionDetail/MessageItem render path is identical to the
 * agent surface. `from_kind` / `from_id` come straight from the IPC row
 * — do NOT synthesise from `role`. Cron / schedule prompts ship as
 * `from_kind === "system"` and must NOT be attributed to the viewing
 * user; synthesising `role === "user"` → `from_kind: "user"` is the bug
 * that makes cron rows render with the founder's name.
 */
function inboxMessagesAdapter(raw: Record<string, unknown>, agentName?: string): Message[] {
  const items = Array.isArray(raw.messages) ? (raw.messages as RawApiMessage[]) : [];
  const result: Message[] = [];
  for (const m of items) {
    const role = typeof m.role === "string" ? m.role.toLowerCase() : "";
    // Render user / assistant / system rows. System rows are runtime-
    // originated (cron-fired schedule prompts, lifecycle seeds) and the
    // canonical resolveAuthor path renders them as a muted system bubble
    // with no avatar / no author name.
    if (role !== "user" && role !== "assistant" && role !== "system") continue;
    const content = typeof m.content === "string" ? m.content : "";
    if (!content.trim()) continue;
    const ts = m.created_at ? new Date(String(m.created_at)).getTime() : Date.now();
    // Read from_kind from the IPC row; fall back to role-based mapping
    // ONLY when the field is null/missing (legacy rows the boot
    // migration has not backfilled yet).
    const rawFromKind = typeof m.from_kind === "string" ? m.from_kind : null;
    let from_kind: Message["from_kind"];
    if (rawFromKind === "user" || rawFromKind === "agent" || rawFromKind === "system") {
      from_kind = rawFromKind;
    } else if (rawFromKind === "position") {
      from_kind = "position";
    } else if (role === "system") {
      from_kind = "system";
    } else if (role === "assistant") {
      from_kind = "agent";
    } else {
      from_kind = "user";
    }
    const from_id = typeof m.from_id === "string" ? m.from_id : null;
    result.push({
      role,
      from_kind,
      from_id,
      content,
      timestamp: ts,
      // Synthetic key — agent rows benefit from agent_name fallback in
      // resolveAuthor when agentNames doesn't carry the agent yet.
      ...(role === "assistant" && agentName ? { askSubject: agentName } : {}),
    });
  }
  return result;
}

// Archive icon — matches the prior InboxComposer icon shape.
function ArchiveIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 13 13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="1" y="2" width="11" height="2.5" rx="0.5" />
      <path d="M2 4.5v5.5a1 1 0 001 1h7a1 1 0 001-1V4.5" />
      <path d="M4.5 7.5h4" />
    </svg>
  );
}

/**
 * `/trust/<addr>/inbox` — the canonical
 * daily-driver Inbox surface.
 *
 * Two-pane layout: toolbar + time-grouped list (left) + SessionDetail
 * (right). Keyboard: j/k traverse, r focus composer, / focus search,
 * Esc clear/unfocus. Real-time pulse on new WS-pushed items.
 *
 * Detail pane is the universal `<SessionDetail>` primitive; this page
 * adapts the inbox transport (per-row `getSessionMessages` fetch + store
 * `answerItem` POST) into its prop contract.
 */
export default function MeInboxPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // Store subscriptions — field-level to avoid selector churn
  const allItems = useInboxStore((s) => s.items);
  const loading = useInboxStore((s) => s.loading);
  const pending = useInboxStore((s) => s.pendingDismissal);
  const answerItem = useInboxStore((s) => s.answerItem);
  const dismissItem = useInboxStore((s) => s.dismissItem);
  const entities = useDaemonStore((s) => s.entities);
  const token = useAuthStore((s) => s.token);

  // Convert visible items to client rows
  const rows: InboxRow[] = useMemo(
    () => allItems.filter((i) => !pending.has(i.session_id)).map(toInboxRow),
    [allItems, pending],
  );

  // Track newly-arrived items for the pulse animation
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const prevRowIdsRef = useRef<Set<string>>(new Set(rows.map((r) => r.id)));
  useEffect(() => {
    const currentIds = new Set(rows.map((r) => r.id));
    const arrived = new Set<string>();
    for (const id of currentIds) {
      if (!prevRowIdsRef.current.has(id)) arrived.add(id);
    }
    prevRowIdsRef.current = currentIds;
    if (arrived.size > 0) {
      setNewIds((prev) => new Set([...prev, ...arrived]));
      const t = window.setTimeout(() => {
        setNewIds((prev) => {
          const next = new Set(prev);
          for (const id of arrived) next.delete(id);
          return next;
        });
      }, 800);
      return () => window.clearTimeout(t);
    }
  }, [rows]);

  // Toolbar state
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<InboxFilterState>(DEFAULT_FILTER);
  const [sort, setSort] = useState<InboxSort>("recent");

  const patchFilter = (patch: Partial<InboxFilterState>) =>
    setFilter((prev) => ({ ...prev, ...patch }));

  // Filter + sort pipeline
  const visible = useMemo(() => {
    let result = rows;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (r) => r.from.name.toLowerCase().includes(q) || r.subject.toLowerCase().includes(q),
      );
    }

    if (filter.kind !== "all") {
      result = result.filter((r) => r.kind === filter.kind);
    }

    if (filter.trustId !== null) {
      result = result.filter((r) => r.trust_id === filter.trustId);
    }

    if (filter.unreadOnly) {
      result = result.filter((r) => r.unread);
    }

    if (sort === "unread") {
      result = [...result].sort((a, b) => {
        if (a.unread === b.unread) return 0;
        return a.unread ? -1 : 1;
      });
    } else {
      result = [...result].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    }

    return result;
  }, [rows, search, filter, sort]);

  // Selection — URL-synced via ?id=
  const urlId = searchParams.get("id");
  const [selectedId, setSelectedId] = useState<string | null>(
    urlId && rows.some((r) => r.id === urlId) ? urlId : null,
  );

  // Default-select first row on load or when current selection disappears
  useEffect(() => {
    if (visible.length === 0) {
      setSelectedId(null);
      return;
    }
    if (selectedId && visible.some((r) => r.id === selectedId)) return;
    setSelectedId(visible[0].id);
  }, [visible, selectedId]);

  // Sync selection to URL
  useEffect(() => {
    if (selectedId) {
      setSearchParams({ id: selectedId }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  }, [selectedId, setSearchParams]);

  const selectedRow = visible.find((r) => r.id === selectedId) ?? null;
  const activeSessionId = selectedRow?.id ?? null;

  // Trust options for the filter popover
  const entityOptions = useMemo(
    () => entities.map((e) => ({ id: e.id, name: e.name ?? e.id })),
    [entities],
  );

  // Refs for keyboard focus targets
  const searchRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  // Keyboard shortcuts: j/k traverse, r focus composer, / focus search, Esc
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tgt = e.target as HTMLElement | null;
      const inInput =
        tgt?.tagName === "INPUT" || tgt?.tagName === "TEXTAREA" || tgt?.isContentEditable;

      if (e.key === "/" && !inInput) {
        e.preventDefault();
        e.stopImmediatePropagation();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }

      if (e.key === "Escape") {
        if (inInput) {
          (tgt as HTMLInputElement | HTMLTextAreaElement).blur();
        } else {
          setSelectedId(null);
        }
        return;
      }

      if (inInput) return;

      if (e.key === "j") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("inbox:traverse", { detail: { direction: "next" } }));
      } else if (e.key === "k") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("inbox:traverse", { detail: { direction: "prev" } }));
      } else if (e.key === "r" && selectedRow) {
        e.preventDefault();
        composerRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [selectedRow]);

  useEffect(() => {
    document.title = "aeqi";
  }, []);

  // ── Per-selection message fetch ──────────────────────────────────────
  // Loads the trailing N messages for the selected session. Was inlined
  // in the prior InboxDetail; lifted here so the visual primitive stays
  // transport-agnostic.
  const [contextMessages, setContextMessages] = useState<Message[]>([]);
  const [contextLoading, setContextLoading] = useState(false);
  const messagesRef = useRef<Message[]>(contextMessages);
  messagesRef.current = contextMessages;
  const sessionIdRef = useRef<string | null>(activeSessionId);
  const prevSessionRef = useRef<string | null>(null);
  useEffect(() => {
    sessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  const setSession = useCallback((sid: string | null) => {
    if (sid) setSelectedId(sid);
  }, []);

  const [, setStreamSessions] = useState<SessionInfo[]>([]);
  const agentNameForStream = selectedRow?.from.name ?? selectedRow?.agent_id ?? "Agent";

  const wsChat = useWebSocketChat({
    token,
    agentId: selectedRow?.agent_id ?? "",
    agentName: agentNameForStream,
    activeSessionId,
    sessionIdRef,
    prevSessionRef,
    setSession,
    setSessions: setStreamSessions,
    messagesRef,
    setMessages: setContextMessages,
    sessionIdeas: [],
    sessionTask: null,
    attachedFiles: [],
  });

  useEffect(() => {
    if (!selectedRow) {
      setContextMessages([]);
      return;
    }
    let cancelled = false;
    setContextLoading(true);
    api
      .getSessionMessages(selectedRow.id, 10)
      .then((raw: Record<string, unknown>) => {
        if (cancelled) return;
        setContextMessages(inboxMessagesAdapter(raw, selectedRow.from.name));
      })
      .catch(() => {
        if (cancelled) return;
        setContextMessages([]);
      })
      .finally(() => {
        if (cancelled) return;
        setContextLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRow]);

  // ── Dismiss / archive endpoint probe ─────────────────────────────────
  // Same lifecycle as the prior InboxComposer probe — fired once at
  // page mount, surfaces availability to the Archive button below.
  const [dismissAvailable, setDismissAvailable] = useState<boolean | null>(null);
  const probedRef = useRef(false);
  useEffect(() => {
    if (probedRef.current) return;
    probedRef.current = true;
    void probeDismissEndpoint().then(setDismissAvailable);
  }, []);

  // ── Composer adapters ─────────────────────────────────────────────────
  const [sendError, setSendError] = useState<string | null>(null);
  // Reset error when selection changes.
  useEffect(() => {
    setSendError(null);
  }, [selectedRow?.id]);

  const handleSend = useCallback(
    async (body: string) => {
      if (!selectedRow) return;
      setSendError(null);
      setContextMessages((prev) => [
        ...prev,
        {
          role: "user",
          from_kind: "user",
          content: body,
          timestamp: Date.now(),
        },
      ]);
      wsChat.attachToLiveStream(selectedRow.id);
      const result = await answerItem(selectedRow.id, body);
      if (!result.ok) {
        wsChat.handleStop(selectedRow.id);
        setSendError(result.error ?? "Failed to send.");
      }
    },
    [selectedRow, answerItem, wsChat],
  );

  const [dismissing, setDismissing] = useState(false);
  const handleDismiss = useCallback(async () => {
    if (!selectedRow || dismissing || dismissAvailable === false) return;
    setDismissing(true);
    setSendError(null);
    const result = await dismissItem(selectedRow.id);
    setDismissing(false);
    if (!result.ok) {
      setSendError(result.error ?? "Failed to archive.");
    }
  }, [selectedRow, dismissing, dismissAvailable, dismissItem]);

  // Active filter chips — kind and entity filters, mirroring IdeasListView pattern
  const activeChips: { key: string; label: string; onRemove: () => void }[] = [];
  if (filter.kind !== "all") {
    activeChips.push({
      key: "kind",
      label: KIND_LABEL[filter.kind] ?? filter.kind,
      onRemove: () => patchFilter({ kind: "all" }),
    });
  }
  if (filter.trustId !== null) {
    const entityName = entityOptions.find((e) => e.id === filter.trustId)?.name ?? filter.trustId;
    activeChips.push({
      key: "entity",
      label: entityName,
      onRemove: () => patchFilter({ trustId: null }),
    });
  }

  // ── Right-pane render shape (only when a row is selected) ────────────
  const renderDetail = () => {
    if (!selectedRow) {
      return (
        <div className="session-detail session-detail--empty">
          <span className="session-detail-placeholder">Nothing selected.</span>
        </div>
      );
    }

    const deepUrl = sessionDeepUrlFromId(
      entities,
      selectedRow.trust_id,
      selectedRow.agent_id,
      selectedRow.id,
    );

    const headerExtras = (
      <>
        <IconButton
          className="inbox-detail-back"
          onClick={() => setSelectedId(null)}
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
        </IconButton>
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
      </>
    );

    const archiveButton = (
      <Tooltip content={dismissAvailable === false ? "Coming soon" : "Archive"}>
        <IconButton
          className="sidebar-row-action-btn inbox-archive-btn"
          onClick={() => void handleDismiss()}
          disabled={dismissing || dismissAvailable === false || dismissAvailable === null}
          aria-label={dismissAvailable === false ? "Archive (coming soon)" : "Archive"}
        >
          <ArchiveIcon />
        </IconButton>
      </Tooltip>
    );

    // The subject line is informationally redundant with the rail row's
    // primary, but reading it large in the detail pane is part of the
    // shipped reading rhythm. Keep it as `subtitle` on the header.
    const subtitle =
      selectedRow.subject && selectedRow.subject !== selectedRow.from.name
        ? selectedRow.subject
        : undefined;
    const threadTrailingSlot =
      wsChat.streaming || wsChat.liveSegments.length > 0 ? (
        <StreamingMessage
          agentName={agentNameForStream}
          liveSegments={wsChat.liveSegments}
          thinkingStart={wsChat.thinkingStart}
          streaming={wsChat.streaming}
          stepOffset={wsChat.liveStepOffset}
        />
      ) : undefined;
    const preThreadSlot = selectedRow.awaiting ? (
      <div className="inbox-awaiting-strip" role="status">
        <span className="inbox-awaiting-strip-icon" aria-hidden>
          <MessageCircleQuestion size={15} strokeWidth={1.8} />
        </span>
        <span className="inbox-awaiting-strip-body">
          <span className="inbox-awaiting-strip-label">Awaiting reply</span>
          {subtitle && <span className="inbox-awaiting-strip-subject">{subtitle}</span>}
        </span>
        <Badge variant="info" size="sm" dot className="inbox-awaiting-strip-chip">
          Decision Request
        </Badge>
      </div>
    ) : undefined;

    return (
      <SessionDetail
        sessionId={selectedRow.id}
        trustId={selectedRow.trust_id ?? undefined}
        agentId={selectedRow.agent_id ?? undefined}
        title={selectedRow.from.name}
        subtitle={subtitle}
        headerExtras={headerExtras}
        messages={contextMessages}
        isStreaming={wsChat.streaming}
        onSend={handleSend}
        onStop={() => wsChat.handleStop(selectedRow.id)}
        composerRef={composerRef}
        composerExtraActions={archiveButton}
        attachmentTypes={["idea", "quest", "file"]}
        composerPlaceholder={`Message ${selectedRow.from.name}…`}
        emptyTitle={contextLoading ? "Loading context…" : "No prior messages."}
        errorMessage={sendError}
        preThreadSlot={preThreadSlot}
        threadTrailingSlot={threadTrailingSlot}
      />
    );
  };

  return (
    <div className={["inbox-shell", selectedId ? "has-selection" : ""].filter(Boolean).join(" ")}>
      {/* Left pane: toolbar + filter chips + list */}
      <div className="inbox-pane-list">
        <InboxToolbar
          search={search}
          filter={filter}
          sort={sort}
          entityOptions={entityOptions}
          onSearch={setSearch}
          onFilter={patchFilter}
          onSort={setSort}
          searchRef={searchRef}
        />
        {activeChips.length > 0 && (
          <div
            className="inbox-filter-chips ideas-list-chips"
            role="list"
            aria-label="Active filters"
          >
            {activeChips.map((c) => (
              <button
                key={c.key}
                type="button"
                role="listitem"
                className="ideas-list-chip"
                onClick={c.onRemove}
                title={`Remove filter: ${c.label}`}
              >
                <span className="ideas-list-chip-label">{c.label}</span>
                <span className="ideas-list-chip-x" aria-hidden>
                  ×
                </span>
              </button>
            ))}
            {activeChips.length > 1 && (
              <button
                type="button"
                className="ideas-list-chip-clear"
                onClick={() => setFilter(DEFAULT_FILTER)}
              >
                Clear all
              </button>
            )}
          </div>
        )}
        <div className="inbox-pane-list-scroll">
          {loading && visible.length === 0 ? (
            <div className="inbox-list-loading">
              <Loading size="sm" />
            </div>
          ) : visible.length === 0 ? (
            <SessionRail
              rows={[]}
              selectedId={null}
              onSelect={setSelectedId}
              emptyTitle="inbox is clear"
            />
          ) : (
            <SessionRail
              rows={visible.map<SessionRailRow>((r) => ({
                id: r.id,
                // Single-line h=32 row to match the agent surface (same
                // SessionRail primitive, same shape on both adopters per
                // the locked direction "render the user inbox like the
                // agent session"). Sender name lives in the detail
                // header on the right pane, not duplicated in the rail.
                primary: r.subject,
                time: timeShort(r.created_at),
                status: r.unread ? "active" : undefined,
                awaiting: r.awaiting,
                group: recencyBucket(r.created_at),
                sortKey: Date.parse(r.created_at) || 0,
                pulseNew: newIds.has(r.id),
              }))}
              selectedId={selectedId}
              onSelect={setSelectedId}
              emptyTitle="inbox is clear"
              traversalEventName="inbox:traverse"
            />
          )}
        </div>
      </div>

      {/* Right pane: SessionDetail (universal primitive) */}
      <div className="inbox-pane-detail">{renderDetail()}</div>
    </div>
  );
}
