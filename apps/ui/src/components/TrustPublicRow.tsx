import { Megaphone, FolderOpen, FileText, MessagesSquare } from "lucide-react";

/**
 * Bottom half/half row for the Trust overview: Updates + Data Room.
 *
 * Reframed 2026-05-20: dropped the "Public" eyebrow and the "Coming
 * soon" CTA. Both surfaces are live — they're just empty until the
 * TRUST posts an update or uploads a document. The empty states now
 * read as "live, not yet populated" instead of "feature not built".
 *
 * Each card flexes to fill the row's height so the surface reads as
 * a real workspace, not a stub block.
 */
export default function TrustPublicRow() {
  return (
    <section className="trust-public-row" aria-label="Updates and Data Room">
      <article className="trust-card trust-public-card">
        <header className="trust-public-head">
          <span className="trust-public-icon" aria-hidden>
            <Megaphone size={16} strokeWidth={1.5} />
          </span>
          <h3 className="trust-public-title">Updates</h3>
        </header>
        <div className="trust-public-body trust-public-body--empty">
          <span className="trust-public-empty-icon" aria-hidden>
            <MessagesSquare size={28} strokeWidth={1.3} />
          </span>
          <p className="trust-public-empty-title">Nothing posted yet.</p>
          <p className="trust-public-empty-hint">
            Milestones, releases, and decisions worth telling the world show up here.
          </p>
        </div>
      </article>

      <article className="trust-card trust-public-card">
        <header className="trust-public-head">
          <span className="trust-public-icon" aria-hidden>
            <FolderOpen size={16} strokeWidth={1.5} />
          </span>
          <h3 className="trust-public-title">Data room</h3>
        </header>
        <div className="trust-public-body trust-public-body--empty">
          <span className="trust-public-empty-icon" aria-hidden>
            <FileText size={28} strokeWidth={1.3} />
          </span>
          <p className="trust-public-empty-title">No documents yet.</p>
          <p className="trust-public-empty-hint">
            Pitch deck, agreements, videos — anything stakeholders need.
          </p>
        </div>
      </article>
    </section>
  );
}
