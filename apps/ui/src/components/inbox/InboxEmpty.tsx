/**
 * Bespoke "you're caught up" empty state for the director inbox.
 *
 * Not built with the shared `EmptyState` primitive because that one is
 * left-aligned-in-a-card and capped at ~22px Exo 2 for the title — wrong
 * shape for a full-page caught-up surface. This one centers vertically
 * in the inbox column and gives the lowercase Exo 2 line its own
 * typographic moment as the page's only display gesture in this state.
 */
export default function InboxEmpty() {
  return (
    <div className="inbox-empty" aria-live="polite">
      <div className="inbox-empty-eyebrow">INBOX</div>
      <h2 className="inbox-empty-title">you&apos;re caught up</h2>
      <p className="inbox-empty-sub">
        agents will surface things here when they need a decision from you.
      </p>
    </div>
  );
}
