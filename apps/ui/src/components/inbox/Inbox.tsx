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
 * The director inbox — replaces the prior home dashboard for users with
 * ≥1 agent. Owns three regions stacked vertically:
 *   1. greeting (Exo 2, stepped DOWN from the old hero size — the page
 *      weight now belongs to the inbox rows below, per the design plan)
 *   2. mono eyebrow with the awaiting count
 *   3. either the rows, the loading skeleton, or the caught-up empty state
 *
 * Real-time updates land via `useDaemonSocket` (the existing single
 * websocket) which dispatches `inbox_update` events into the store.
 * On mount we kick off a fresh fetch; we also re-fetch when the WS
 * reconnects, since the in-flight tick window can drop events.
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
      <h1 className="inbox-greeting">{heading}</h1>
      <div className="inbox-eyebrow" aria-hidden="true">
        <span>INBOX</span>
        <span className="inbox-eyebrow-sep">·</span>
        <span>{count > 0 ? `${count} AWAITING` : "CAUGHT UP"}</span>
      </div>
      {showSkeleton ? <InboxLoading /> : showEmpty ? <InboxEmpty /> : <InboxList items={items} />}
    </section>
  );
}
