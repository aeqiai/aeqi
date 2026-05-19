import { Megaphone, FolderOpen, ArrowUpRight } from "lucide-react";

/**
 * Bottom half-half row for the Trust overview:
 *   · Updates — public timeline (milestones, releases, posts)
 *   · Data Room — public documents (pitch deck, agreements, videos)
 *
 * Both surfaces are public-facing — the visitor on /trust/<addr> sees
 * the same thing as the operator viewing /trust/<addr>/overview. This
 * is the TRUST's storefront half of the page: how the world reads it.
 *
 * Currently rendered as opt-in placeholder cards. When the backend
 * lands (posts feed, document store), wire data into the inner lists.
 */
export default function TrustPublicRow() {
  return (
    <section className="trust-public-row" aria-label="Public surface">
      <article className="trust-card trust-public-card">
        <header className="trust-public-head">
          <span className="trust-public-icon" aria-hidden>
            <Megaphone size={16} strokeWidth={1.5} />
          </span>
          <div className="trust-public-titles">
            <p className="trust-public-eyebrow">Public</p>
            <h3 className="trust-public-title">Updates</h3>
          </div>
        </header>
        <div className="trust-public-body">
          <p className="trust-public-lede">
            Milestones, releases, and decisions worth telling the world.
          </p>
          <p className="trust-public-aside">
            The TRUST's public timeline — everything visitors see when they land on this profile.
          </p>
        </div>
        <footer className="trust-public-foot">
          <span className="trust-public-cta">
            Coming soon
            <ArrowUpRight size={12} strokeWidth={1.8} />
          </span>
        </footer>
      </article>

      <article className="trust-card trust-public-card">
        <header className="trust-public-head">
          <span className="trust-public-icon" aria-hidden>
            <FolderOpen size={16} strokeWidth={1.5} />
          </span>
          <div className="trust-public-titles">
            <p className="trust-public-eyebrow">Public</p>
            <h3 className="trust-public-title">Data room</h3>
          </div>
        </header>
        <div className="trust-public-body">
          <p className="trust-public-lede">
            Documents, pitch deck, videos — what stakeholders need to look at this TRUST seriously.
          </p>
          <p className="trust-public-aside">
            One canonical drop for anything that should outlive a conversation.
          </p>
        </div>
        <footer className="trust-public-foot">
          <span className="trust-public-cta">
            Coming soon
            <ArrowUpRight size={12} strokeWidth={1.8} />
          </span>
        </footer>
      </article>
    </section>
  );
}
