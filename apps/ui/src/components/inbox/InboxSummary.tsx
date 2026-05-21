import type { InboxRow } from "./types";

interface InboxSummaryProps {
  rows: ReadonlyArray<InboxRow>;
  visibleCount: number;
}

export default function InboxSummary({ rows, visibleCount }: InboxSummaryProps) {
  const total = rows.length;
  const awaiting = rows.filter((r) => r.awaiting).length;
  const unread = rows.filter((r) => r.unread).length;
  const decisions = rows.filter((r) => r.kind === "decision_request").length;
  const trustScopes = new Set(rows.map((r) => r.trust_id).filter(Boolean)).size;
  const reviewDetail =
    awaiting > 0
      ? `${awaiting} ${awaiting === 1 ? "handoff" : "handoffs"} awaiting reply`
      : "No agent handoffs waiting";
  const itemDetail =
    visibleCount === total
      ? `${unread} ${unread === 1 ? "unread item" : "unread items"}`
      : `${visibleCount} shown by filters`;

  const cards = [
    { label: "Needs review", value: awaiting, detail: reviewDetail, tone: "review" },
    { label: "Inbox items", value: total, detail: itemDetail, tone: "neutral" },
    {
      label: "Decision requests",
      value: decisions,
      detail: "Approvals, proposals, and agent questions",
      tone: "progress",
    },
    {
      label: "TRUST scope",
      value: trustScopes,
      detail:
        trustScopes > 0
          ? `${trustScopes === 1 ? "One TRUST" : "TRUSTs"} represented in this queue`
          : "No TRUST context in this queue",
      tone: "neutral",
    },
  ];

  return (
    <section className="inbox-summary" aria-label="Inbox operating state">
      {cards.map((card) => (
        <article key={card.label} className="inbox-summary-card" data-tone={card.tone}>
          <span className="inbox-summary-label">{card.label}</span>
          <span className="inbox-summary-value">{card.value}</span>
          <span className="inbox-summary-detail">{card.detail}</span>
        </article>
      ))}
    </section>
  );
}
