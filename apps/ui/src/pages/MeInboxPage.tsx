import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useInboxStore } from "@/store/inbox";
import { useDaemonStore } from "@/store/daemon";
import InboxToolbar from "@/components/inbox/InboxToolbar";
import InboxDetail from "@/components/inbox/InboxDetail";
import SessionRail, { type SessionRailRow } from "@/components/sessions/SessionRail";
import { Spinner } from "@/components/ui";
import { toInboxRow, DEFAULT_FILTER } from "@/components/inbox/types";
import type { InboxFilterState, InboxRow, InboxSort } from "@/components/inbox/types";
import { recencyBucket, timeShort } from "@/lib/format";

const KIND_LABEL: Record<string, string> = {
  decision_request: "Decision requests",
  system: "System",
};

/**
 * `/` — the canonical daily-driver Inbox surface.
 *
 * Two-pane layout: toolbar + time-grouped list (left) + detail/composer (right).
 * Keyboard: j/k traverse, r focus composer, / focus search, Esc clear/unfocus.
 * Real-time pulse on new WS-pushed items. Composer via answerItem (POST).
 */
export default function MeInboxPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Store subscriptions — field-level to avoid selector churn
  const allItems = useInboxStore((s) => s.items);
  const loading = useInboxStore((s) => s.loading);
  const pending = useInboxStore((s) => s.pendingDismissal);
  const answerItem = useInboxStore((s) => s.answerItem);
  const dismissItem = useInboxStore((s) => s.dismissItem);
  const entities = useDaemonStore((s) => s.entities);

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

    if (filter.entityId !== null) {
      result = result.filter((r) => r.entity_id === filter.entityId);
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

  // Entity options for the filter popover
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
      } else if (e.key === "r") {
        if (selectedRow?.replyable) {
          e.preventDefault();
          composerRef.current?.focus();
        }
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [selectedRow]);

  useEffect(() => {
    document.title = "inbox · æiq";
  }, []);

  // Active filter chips — kind and entity filters, mirroring IdeasListView pattern
  const activeChips: { key: string; label: string; onRemove: () => void }[] = [];
  if (filter.kind !== "all") {
    activeChips.push({
      key: "kind",
      label: KIND_LABEL[filter.kind] ?? filter.kind,
      onRemove: () => patchFilter({ kind: "all" }),
    });
  }
  if (filter.entityId !== null) {
    const entityName = entityOptions.find((e) => e.id === filter.entityId)?.name ?? filter.entityId;
    activeChips.push({
      key: "entity",
      label: entityName,
      onRemove: () => patchFilter({ entityId: null }),
    });
  }

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
              <Spinner size="sm" />
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
                awaiting: r.replyable,
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

      {/* Right pane: detail + composer */}
      <div className="inbox-pane-detail">
        <InboxDetail
          row={selectedRow}
          onAnswer={answerItem}
          onDismiss={dismissItem}
          onBack={() => setSelectedId(null)}
          composerRef={composerRef}
        />
      </div>
    </div>
  );
}
