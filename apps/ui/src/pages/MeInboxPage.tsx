import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArrowLeft, CornerUpLeft, ExternalLink } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { sessionDeepUrlFromId } from "@/lib/sessionUrl";
import { useAuthStore } from "@/store/auth";
import { useInboxStore, probeDismissEndpoint } from "@/store/inbox";
import { useDaemonStore } from "@/store/daemon";
import { useNav } from "@/hooks/useNav";
import InboxToolbar from "@/components/inbox/InboxToolbar";
import InboxEmptyCanvas from "@/components/inbox/InboxEmptyCanvas";
import { inboxMessagesAdapter } from "@/components/inbox/inboxMessagesAdapter";
import ParticipantStrip from "@/components/sessions/ParticipantStrip";
import SessionRail, { type SessionRailRow } from "@/components/sessions/SessionRail";
import SessionDetail from "@/components/sessions/SessionDetail";
import StreamingMessage from "@/components/session/StreamingMessage";
import { useWebSocketChat } from "@/components/session/useWebSocketChat";
import { Button, Loading, PrimitivePageHeader, Tooltip } from "@/components/ui";
import { toInboxRow, DEFAULT_FILTER } from "@/components/inbox/types";
import type { InboxFilterState, InboxRow, InboxSort } from "@/components/inbox/types";
import type { Message, SessionInfo } from "@/components/session/types";
import { recencyBucket, timeShort } from "@/lib/format";
import { getInboxSignal, visibleInboxSignalLabel } from "@/lib/inboxState";

const KIND_LABEL: Record<string, string> = {
  decision_request: "Decision requests",
  system: "System",
};

const KIND_ITEM_LABEL: Record<string, string> = {
  decision_request: "Decision request",
  system: "System",
};

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
  const { trustId } = useNav();

  // Store subscriptions — field-level to avoid selector churn
  const allItems = useInboxStore((s) => s.items);
  const loading = useInboxStore((s) => s.loading);
  const pending = useInboxStore((s) => s.pendingDismissal);
  const fetchInbox = useInboxStore((s) => s.fetchInbox);
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
  const entityNameById = useMemo(
    () => new Map(entityOptions.map((entity) => [entity.id, entity.name])),
    [entityOptions],
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

  useEffect(() => {
    void fetchInbox();
  }, [fetchInbox]);

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
    trustId,
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
      .getSessionMessages(selectedRow.id, 100, trustId || undefined)
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
  }, [selectedRow, trustId]);

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

  const selectedDeepUrl = selectedRow
    ? sessionDeepUrlFromId(entities, selectedRow.trust_id, selectedRow.agent_id, selectedRow.id)
    : null;
  const selectedHeaderSignal = selectedRow
    ? getInboxSignal({
        awaiting: selectedRow.awaiting,
        unread: selectedRow.unread,
      })
    : null;
  const selectedSubjectLine =
    selectedRow?.subject && selectedRow.subject !== selectedRow.from.name
      ? selectedRow.subject
      : undefined;
  const selectedKindLabel = selectedRow ? (KIND_ITEM_LABEL[selectedRow.kind] ?? "Inbox item") : "";
  const selectedSubtitle =
    selectedRow && [selectedKindLabel, selectedSubjectLine].filter(Boolean).join(" · ");
  const selectedArchiveButton =
    selectedRow && dismissAvailable === true ? (
      <Tooltip content="Archive this thread">
        <Button
          variant="secondary"
          size="sm"
          className="inbox-archive-btn"
          onClick={() => void handleDismiss()}
          loading={dismissing}
          aria-label="Archive"
          leadingIcon={<Archive size={13} strokeWidth={1.7} aria-hidden />}
        >
          Archive
        </Button>
      </Tooltip>
    ) : null;

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

  const hasActiveNarrowing =
    search.trim().length > 0 ||
    filter.kind !== "all" ||
    filter.trustId !== null ||
    filter.unreadOnly;
  const emptyInboxTitle = hasActiveNarrowing ? "No matching inbox items" : "Inbox clear";
  const emptyInboxHint = hasActiveNarrowing
    ? "Adjust search or filters to return to the full inbox."
    : "No reviews, approvals, failed events, or agent handoffs need attention.";

  // ── Right-pane render shape (only when a row is selected) ────────────
  const renderDetail = () => {
    if (!selectedRow) {
      const isEmptyInbox = visible.length === 0 && !loading;
      const title = isEmptyInbox ? emptyInboxTitle : "Select a thread";
      const hint = isEmptyInbox
        ? emptyInboxHint
        : "Choose an inbox item from the rail to review the conversation and reply.";

      return (
        <div className="session-detail session-detail--empty">
          <InboxEmptyCanvas title={title} hint={hint} kind={isEmptyInbox ? "empty" : "select"} />
        </div>
      );
    }

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
        <span
          className="inbox-awaiting-strip-dot quest-status-dot quest-status-dot--in_review"
          aria-hidden
        />
        <span className="inbox-awaiting-strip-body">
          <span className="inbox-awaiting-strip-label">Awaiting reply</span>
          {selectedSubjectLine && (
            <span className="inbox-awaiting-strip-subject">{selectedSubjectLine}</span>
          )}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="inbox-awaiting-strip-action"
          onClick={() => composerRef.current?.focus()}
          aria-label="Reply to this decision request"
          leadingIcon={<CornerUpLeft size={13} strokeWidth={1.8} aria-hidden />}
        >
          Reply
        </Button>
      </div>
    ) : undefined;

    return (
      <SessionDetail
        sessionId={selectedRow.id}
        trustId={selectedRow.trust_id ?? undefined}
        agentId={selectedRow.agent_id ?? undefined}
        title={selectedRow.from.name}
        subtitle={selectedSubtitle || undefined}
        messages={contextMessages}
        isStreaming={wsChat.streaming}
        onSend={handleSend}
        onStop={() => wsChat.handleStop(selectedRow.id)}
        composerRef={composerRef}
        attachmentTypes={["idea", "quest", "file"]}
        composerPlaceholder={`Message ${selectedRow.from.name}…`}
        emptyTitle={contextLoading ? "Loading context…" : "No prior messages."}
        errorMessage={sendError}
        preThreadSlot={preThreadSlot}
        threadTrailingSlot={threadTrailingSlot}
        hideHeader
        surface="recessed"
      />
    );
  };

  return (
    <div className="inbox-page">
      <PrimitivePageHeader
        className="inbox-page-header"
        title={
          <span className="inbox-title">
            <span className="inbox-title-text">Inbox</span>
            <span className="inbox-count" aria-label={`${visible.length} shown`}>
              {visible.length}
            </span>
          </span>
        }
        children={
          <InboxToolbar
            inline
            search={search}
            filter={filter}
            sort={sort}
            entityOptions={entityOptions}
            onSearch={setSearch}
            onFilter={patchFilter}
            onSort={setSort}
            searchRef={searchRef}
          />
        }
        actions={
          <Button
            variant="primary"
            size="md"
            onClick={() => composerRef.current?.focus()}
            disabled={!selectedRow}
            leadingIcon={<CornerUpLeft size={14} strokeWidth={1.8} />}
          >
            Reply
          </Button>
        }
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
      {selectedRow && selectedDeepUrl && (
        <div className="inbox-detail-strip trust-session-detail-strip">
          <div className="session-detail-header trust-session-detail-header inbox-detail-header">
            <div className="session-detail-header-from">
              <span className="session-detail-header-title">{selectedRow.from.name}</span>
              <div className="session-detail-header-meta">
                {selectedSubtitle && (
                  <span className="session-detail-header-subtitle">{selectedSubtitle}</span>
                )}
              </div>
            </div>
            <div className="session-detail-header-extras">
              <ParticipantStrip
                sessionId={selectedRow.id}
                trustId={selectedRow.trust_id ?? undefined}
              />
              {selectedHeaderSignal?.detailState && (
                <span className="inbox-detail-state" data-state={selectedHeaderSignal.detailState}>
                  {selectedHeaderSignal.label}
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="inbox-detail-back"
                onClick={() => setSelectedId(null)}
                aria-label="Back to inbox list"
                leadingIcon={<ArrowLeft size={12} strokeWidth={1.8} aria-hidden />}
              >
                Back
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(selectedDeepUrl)}
                title="View full session"
                trailingIcon={<ExternalLink size={12} strokeWidth={1.8} aria-hidden />}
                trailingIconMode="inline"
              >
                Full session
              </Button>
              {selectedArchiveButton}
            </div>
          </div>
        </div>
      )}

      <div
        className={[
          "inbox-shell",
          selectedId ? "has-selection" : "",
          visible.length === 0 && !loading ? "is-empty" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {/* Left pane: inbox item cards */}
        <div className="inbox-pane-list">
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
                density="comfortable"
                surface="card"
                tone="light"
                emptyTitle={hasActiveNarrowing ? "No matches" : "No items"}
                emptyStateClassName="sessions-rail-empty--compact"
              />
            ) : (
              <SessionRail
                rows={visible.map<SessionRailRow>((r) => {
                  const rowKind = KIND_ITEM_LABEL[r.kind] ?? "Inbox item";
                  const scopeName = r.trust_id
                    ? (entityNameById.get(r.trust_id) ?? r.trust_id)
                    : null;
                  const signal = getInboxSignal({ awaiting: r.awaiting, unread: r.unread });
                  const signalLabel = visibleInboxSignalLabel(signal);
                  return {
                    id: r.id,
                    primary: r.subject,
                    secondary: [signalLabel, r.from.name, rowKind, scopeName]
                      .filter(Boolean)
                      .join(" · "),
                    time: timeShort(r.created_at),
                    status: signal.rowStatus,
                    awaiting: signal.awaiting,
                    group: recencyBucket(r.created_at),
                    sortKey: Date.parse(r.created_at) || 0,
                    pulseNew: newIds.has(r.id),
                    wrapPrimary: true,
                  };
                })}
                selectedId={selectedId}
                onSelect={setSelectedId}
                density="comfortable"
                surface="card"
                tone="light"
                emptyTitle={emptyInboxTitle}
                emptyHint={emptyInboxHint}
                traversalEventName="inbox:traverse"
              />
            )}
          </div>
        </div>

        {/* Right pane: SessionDetail (universal primitive) */}
        <div className="inbox-pane-detail">{renderDetail()}</div>
      </div>
    </div>
  );
}
