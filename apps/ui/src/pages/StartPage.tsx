import { useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Inbox as InboxIcon, Store, ArrowUpRight, ArrowRight } from "lucide-react";
import { useAuthStore } from "@/store/auth";
import { useEntities } from "@/queries/entities";
import { useInboxStore } from "@/store/inbox";
import { entityPath } from "@/lib/entityPath";
import { sessionDeepUrlFromId } from "@/lib/sessionUrl";
import { timeShort } from "@/lib/format";
import BlockAvatar from "@/components/BlockAvatar";
import type { Trust, TrustType } from "@/lib/types";

/**
 * Home dashboard at `/`. Reframed 2026-05-19 (cards-v2):
 *
 *   1. Hero image with greeting overlay and account-avatar affordance
 *      in the top-right (single-click to /account).
 *   2. "Step into a trust" CARD (full-width): a row of per-trust tiles
 *      (avatar + name + role context), plus [+ New trust] and
 *      [Browse blueprints] action tiles. Header carries a "View all →"
 *      link to /trust for the picker.
 *   3. Two-column row: live Inbox CARD on the left (rich items with
 *      avatar + subject + preview + time); Economy CARD on the right
 *      (quiet teaser — no fake feature tags).
 *   4. Thesis CARD (full-width): editorial typography linking to the
 *      canonical /blog/the-uncompiled-institution post.
 *
 * All blocks are real cards in the design-system theme (graphite + ink,
 * no hairlines, no decorative motion). Composition + scale carry the
 * weight.
 */

const TRUST_TILE_LIMIT = 5;
const INBOX_PREVIEW_LIMIT = 4;

// Trust.type → display label. `dao` is intentionally remapped to
// "Protocol" (brand rule bans "DAO" in user-facing UI copy). When the
// runtime exposes a real role-per-(user × trust) value, swap this for
// that data and rename `roleLabelFor` accordingly.
function roleLabelFor(type: TrustType | undefined): string {
  switch (type) {
    case "company":
      return "Company";
    case "human":
      return "Personal";
    case "agent":
      return "Agent";
    case "fund":
      return "Fund";
    case "dao":
      return "Protocol";
    case "holding":
      return "Holding";
    case "protocol":
      return "Protocol";
    default:
      return "TRUST";
  }
}

export default function StartPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const entities = useEntities();
  const inboxItems = useInboxStore((s) => s.items);
  const fetchInbox = useInboxStore((s) => s.fetchInbox);

  const actorName = useMemo(
    () => user?.name?.trim() || user?.email?.split("@")[0] || "friend",
    [user],
  );

  useEffect(() => {
    fetchInbox().catch(() => {
      // store handles its own error state; preview shows empty affordance.
    });
  }, [fetchInbox]);

  const trustTiles = entities.slice(0, TRUST_TILE_LIMIT);
  const trustOverflow = Math.max(0, entities.length - TRUST_TILE_LIMIT);
  const inboxPreview = inboxItems.slice(0, INBOX_PREVIEW_LIMIT);
  const inboxCount = inboxItems.length;

  return (
    <div className="home-page">
      <header className="home-hero">
        <img src="/welcome/start-hero.png" alt="" className="home-hero-image" aria-hidden="true" />
        <div className="home-hero-overlay">
          <div className="home-hero-text">
            <h1 className="home-hero-title">Welcome, {actorName}.</h1>
            <p className="home-hero-subtitle">
              Launch a TRUST, review what needs approval, or step into the economy already forming
              around you.
            </p>
          </div>
          <Link
            to="/account"
            className="home-hero-account"
            aria-label="Account settings"
            title="Account settings"
          >
            <BlockAvatar name={actorName} size={36} />
          </Link>
        </div>
      </header>

      <TrustCard
        entities={entities}
        trustTiles={trustTiles}
        trustOverflow={trustOverflow}
        onPickTrust={(e: Trust) => navigate(entityPath(e))}
        onNewTrust={() => navigate("/launch")}
        onBrowseBlueprints={() => navigate("/blueprints")}
        onViewAll={() => navigate("/trust")}
      />

      <section className="home-row-two" aria-label="Inbox and economy">
        <button
          type="button"
          className="home-card home-card--inbox"
          onClick={() => navigate("/inbox")}
        >
          <header className="home-card-head">
            <span className="home-card-icon">
              <InboxIcon size={16} strokeWidth={1.5} />
            </span>
            <span className="home-card-title">Inbox</span>
            <span className="home-card-meta">
              {inboxCount === 0 ? "All clear" : `${inboxCount} waiting`}
            </span>
          </header>
          {inboxPreview.length > 0 ? (
            <ul className="home-inbox-list">
              {inboxPreview.map((item) => {
                const subject =
                  item.awaiting_subject ||
                  item.session_name ||
                  item.last_agent_message?.slice(0, 80) ||
                  "Untitled session";
                const preview = item.last_agent_message?.replace(/\s+/g, " ").trim() || "";
                const from = item.agent_name || "Agent";
                const time = timeShort(item.awaiting_at || item.last_active);
                return (
                  <li key={item.session_id} className="home-inbox-item">
                    <Link
                      className="home-inbox-link"
                      to={sessionDeepUrlFromId(
                        entities,
                        item.trust_id,
                        item.agent_id,
                        item.session_id,
                      )}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="home-inbox-avatar" aria-hidden="true">
                        <BlockAvatar name={from} size={28} />
                      </span>
                      <span className="home-inbox-body">
                        <span className="home-inbox-row">
                          <span className="home-inbox-from">{from}</span>
                          <span className="home-inbox-time">{time}</span>
                        </span>
                        <span className="home-inbox-subject">{subject}</span>
                        {preview && <span className="home-inbox-preview">{preview}</span>}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="home-inbox-empty">
              <span className="home-inbox-empty-icon" aria-hidden="true">
                <InboxIcon size={28} strokeWidth={1.4} />
              </span>
              <p className="home-inbox-empty-title">Inbox is clear.</p>
              <p className="home-inbox-empty-hint">
                Approvals and proposals appear here when an agent needs you.
              </p>
            </div>
          )}
          <footer className="home-card-foot">
            <span className="home-card-cta">
              Open inbox
              <ArrowRight size={14} strokeWidth={1.8} />
            </span>
          </footer>
        </button>

        <button
          type="button"
          className="home-card home-card--economy"
          onClick={() => navigate("/economy")}
        >
          <header className="home-card-head">
            <span className="home-card-icon">
              <Store size={16} strokeWidth={1.5} />
            </span>
            <span className="home-card-title">The economy</span>
          </header>
          <div className="home-economy-body">
            <p className="home-economy-lede">
              Discover TRUSTs, agents, markets, and capital activity across the network.
            </p>
            <p className="home-economy-aside">
              The places where TRUSTs meet — and where the value moves between them.
            </p>
          </div>
          <footer className="home-card-foot">
            <span className="home-card-cta">
              Browse
              <ArrowRight size={14} strokeWidth={1.8} />
            </span>
          </footer>
        </button>
      </section>

      <section className="home-thesis" aria-label="Thesis">
        <a
          className="home-thesis-card"
          href="https://aeqi.ai/blog/the-uncompiled-institution"
          target="_blank"
          rel="noreferrer"
        >
          <div className="home-thesis-left">
            <span className="home-thesis-eyebrow">Thesis</span>
            <h2 className="home-thesis-title">The uncompiled institution.</h2>
            <p className="home-thesis-quote">
              Institutions are software that has not been compiled yet.
            </p>
          </div>
          <div className="home-thesis-right">
            <span className="home-thesis-byline">May 2, 2026 · Luca Eichs</span>
            <span className="home-thesis-read">
              Read on aeqi.ai
              <ArrowUpRight size={14} strokeWidth={1.8} />
            </span>
          </div>
        </a>
      </section>
    </div>
  );
}

interface TrustCardProps {
  entities: ReadonlyArray<Trust>;
  trustTiles: ReadonlyArray<Trust>;
  trustOverflow: number;
  onPickTrust: (entity: Trust) => void;
  onNewTrust: () => void;
  onBrowseBlueprints: () => void;
  onViewAll: () => void;
}

function TrustCard({
  entities,
  trustTiles,
  trustOverflow,
  onPickTrust,
  onNewTrust,
  onBrowseBlueprints,
  onViewAll,
}: TrustCardProps) {
  const hasEntities = entities.length > 0;
  return (
    <section className="home-card home-card--trusts" aria-label="Your TRUSTs">
      <header className="home-card-head">
        <span className="home-card-title">Step into a TRUST</span>
        <span className="home-card-meta">
          {hasEntities
            ? `${entities.length} TRUST${entities.length === 1 ? "" : "s"}`
            : "Nothing yet"}
        </span>
        {hasEntities && (
          <button type="button" className="home-card-link" onClick={onViewAll}>
            View all
            <ArrowRight size={14} strokeWidth={1.8} />
          </button>
        )}
      </header>

      <div className="home-trusts-grid">
        {trustTiles.map((entity) => (
          <button
            key={entity.id}
            type="button"
            className="home-trust-tile"
            onClick={() => onPickTrust(entity)}
            aria-label={`Step into TRUST ${entity.name}`}
          >
            <span className="home-trust-tile-avatar" aria-hidden="true">
              <BlockAvatar name={entity.name} size={40} />
            </span>
            <span className="home-trust-tile-body">
              <span className="home-trust-tile-name">{entity.name}</span>
              <span className="home-trust-tile-role">{roleLabelFor(entity.type)}</span>
            </span>
          </button>
        ))}
        {trustOverflow > 0 && (
          <button
            type="button"
            className="home-trust-tile home-trust-tile--overflow"
            onClick={onViewAll}
          >
            <span className="home-trust-tile-overflow-count">+{trustOverflow}</span>
            <span className="home-trust-tile-overflow-label">more TRUSTs</span>
          </button>
        )}
        <button
          type="button"
          className="home-trust-tile home-trust-tile--action home-trust-tile--primary"
          onClick={onNewTrust}
        >
          <span className="home-trust-tile-action-icon">
            <Plus size={18} strokeWidth={1.8} />
          </span>
          <span className="home-trust-tile-body">
            <span className="home-trust-tile-name">New TRUST</span>
            <span className="home-trust-tile-role">Start from scratch</span>
          </span>
        </button>
        <button
          type="button"
          className="home-trust-tile home-trust-tile--action"
          onClick={onBrowseBlueprints}
        >
          <span className="home-trust-tile-action-icon">
            <ArrowRight size={18} strokeWidth={1.8} />
          </span>
          <span className="home-trust-tile-body">
            <span className="home-trust-tile-name">Browse blueprints</span>
            <span className="home-trust-tile-role">Use a template</span>
          </span>
        </button>
      </div>
    </section>
  );
}
