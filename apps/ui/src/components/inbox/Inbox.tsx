import { useEffect, useMemo } from "react";
import { useDaemonStore } from "@/store/daemon";
import { useInboxStore } from "@/store/inbox";
import InboxEmpty from "./InboxEmpty";
import InboxList from "./InboxList";
import InboxLoading from "./InboxLoading";

interface InboxProps {
  /** Greeting line ("good afternoon, alex") computed by HomeDashboard. */
  heading: string;
}

/**
 * The director inbox — replaces the prior home dashboard for users
 * with ≥1 agent. Two regions:
 *   1. greeting (Exo 2, restrained — one typographic gesture per
 *      page; nothing else competes with it for emphasis)
 *   2. either the row groups, the loading skeleton, or the caught-up
 *      empty state. Rows are date-grouped (today / yesterday / earlier
 *      this week / older); group labels are the only chrome between
 *      clusters.
 *
 * The "INBOX · N AWAITING" eyebrow that lived between the greeting
 * and the rows has been removed — the count is in the document title
 * already, and the page name is implied by being on /. One less
 * editorial gesture per the "restraint over flourish" memory.
 *
 * Real-time updates land via `useDaemonSocket` (the existing single
 * websocket) which dispatches `inbox_update` events into the store.
 * Initial fetch on mount + on WS reconnect to resync any window of
 * dropped events.
 */
export default function Inbox({ heading }: InboxProps) {
  // Subscribe to the raw fields, derive `items` + `count` inside the
  // component with useMemo. A computed selector that returns a fresh
  // array (e.g. items.filter(…)) would yield a new identity every render
  // and trip Zustand's "selector returned a new value" loop guard
  // (Maximum update depth exceeded). The raw fields have stable
  // identities — Set#has and length checks compare cheaply.
  const rawItems = useInboxStore((s) => s.items);
  const pendingDismissal = useInboxStore((s) => s.pendingDismissal);
  const loading = useInboxStore((s) => s.loading);
  const lastFetchedAt = useInboxStore((s) => s.lastFetchedAt);
  const fetchInbox = useInboxStore((s) => s.fetchInbox);
  const wsConnected = useDaemonStore((s) => s.wsConnected);

  const items = useMemo(
    () => rawItems.filter((i) => !pendingDismissal.has(i.session_id)),
    [rawItems, pendingDismissal],
  );
  const count = items.length;

  // Initial fetch on mount + after WS reconnect (to resync any updates
  // that happened during the disconnected window).
  useEffect(() => {
    void fetchInbox();
  }, [fetchInbox, wsConnected]);

  useEffect(() => {
    document.title = count > 0 ? `(${count}) inbox · æqi` : "inbox · æqi";
  }, [count]);

  const showSkeleton = loading && lastFetchedAt === null;
  const showEmpty = !showSkeleton && items.length === 0;

  return (
    <section className="inbox" aria-label="Director inbox">
      <header className="inbox-header">
        <h1 className="inbox-greeting">{heading}</h1>
      </header>
      {showSkeleton ? <InboxLoading /> : showEmpty ? <InboxEmpty /> : <InboxList items={items} />}
    </section>
  );
}
