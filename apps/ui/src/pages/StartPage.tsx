import { useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Inbox as InboxIcon, Store, ArrowUpRight, ArrowRight, Users } from "lucide-react";
import { useAuthStore } from "@/store/auth";
import { useEntities } from "@/queries/entities";
import { useInboxStore } from "@/store/inbox";
import { entityPath } from "@/lib/entityPath";
import { sessionDeepUrlFromId } from "@/lib/sessionUrl";
import { timeShort } from "@/lib/format";
import BlockAvatar from "@/components/BlockAvatar";
import type { Trust } from "@/lib/types";

/**
 * Home dashboard at `/`. Reframed 2026-05-19 (cards-v3):
 *
 *   1. Hero image with greeting overlay + a soft top-left fade so the
 *      surface reads ethereal, not flat.
 *   2. Trust row — three side-by-side cards:
 *        · Personal TRUST  (your own, click to step in)
 *        · Step into a TRUST  (New TRUST + Browse blueprints)
 *        · All TRUSTs  (browse every TRUST you can step into)
 *   3. Two-column row: live Inbox (left) + Economy (right). Each card
 *      carries its "View all →" link in the top-right of the head, not
 *      the foot, so the navigation action is where the eye goes first.
 *   4. Thesis card (full-width): editorial moment linking the canonical
 *      blog post.
 */

const INBOX_PREVIEW_LIMIT = 4;
const ALL_TRUSTS_AVATAR_LIMIT = 4;

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

  // The platform doesn't yet surface a `personal` flag on entities — the
  // first entity is, by signup invariant, the user's own TRUST (signup
  // auto-creates one 1-owner Company). When a real signal lands, swap
  // this for that flag.
  const personal = entities[0] ?? null;
  const otherTrusts = useMemo(
    () => (personal ? entities.filter((e) => e.id !== personal.id) : []),
    [entities, personal],
  );

  const inboxPreview = inboxItems.slice(0, INBOX_PREVIEW_LIMIT);
  const inboxCount = inboxItems.length;

  return (
    <div className="home-page">
      <header className="home-hero">
        <img src="/welcome/start-hero.png" alt="" className="home-hero-image" aria-hidden="true" />
        <span className="home-hero-fade" aria-hidden="true" />
        <div className="home-hero-overlay">
          <div className="home-hero-text">
            <h1 className="home-hero-title">Welcome, {actorName}.</h1>
            <p className="home-hero-subtitle">
              Launch a TRUST, review what needs approval, or step into the economy already forming
              around you.
            </p>
          </div>
        </div>
      </header>

      <section className="home-row-trusts" aria-label="Your TRUSTs">
        <PersonalTrustCard
          personal={personal}
          onOpen={(t) => navigate(entityPath(t))}
          onCreate={() => navigate("/launch")}
        />
        <StepIntoTrustCard
          onNewTrust={() => navigate("/launch")}
          onBrowseBlueprints={() => navigate("/blueprints")}
        />
        <AllTrustsCard
          others={otherTrusts}
          totalCount={entities.length}
          onViewAll={() => navigate("/trust")}
          onPick={(t) => navigate(entityPath(t))}
        />
      </section>

      <section className="home-row-two" aria-label="Inbox and economy">
        <article className="home-card home-card--inbox">
          <header className="home-card-head">
            <span className="home-card-icon">
              <InboxIcon size={16} strokeWidth={1.5} />
            </span>
            <span className="home-card-title">Inbox</span>
            <span className="home-card-meta">
              {inboxCount === 0 ? "All clear" : `${inboxCount} waiting`}
            </span>
            <button type="button" className="home-card-link" onClick={() => navigate("/inbox")}>
              View all
              <ArrowRight size={14} strokeWidth={1.8} />
            </button>
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
        </article>

        <article className="home-card home-card--economy">
          <header className="home-card-head">
            <span className="home-card-icon">
              <Store size={16} strokeWidth={1.5} />
            </span>
            <span className="home-card-title">The economy</span>
            <button type="button" className="home-card-link" onClick={() => navigate("/economy")}>
              View all
              <ArrowRight size={14} strokeWidth={1.8} />
            </button>
          </header>
          <div className="home-economy-body">
            <p className="home-economy-lede">
              Discover TRUSTs, agents, markets, and capital activity across the network.
            </p>
            <p className="home-economy-aside">
              The places where TRUSTs meet — and where the value moves between them.
            </p>
          </div>
        </article>
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

interface PersonalTrustCardProps {
  personal: Trust | null;
  onOpen: (trust: Trust) => void;
  onCreate: () => void;
}

function PersonalTrustCard({ personal, onOpen, onCreate }: PersonalTrustCardProps) {
  if (!personal) {
    return (
      <button
        type="button"
        className="home-card home-card--personal home-card--empty"
        onClick={onCreate}
      >
        <header className="home-card-head">
          <span className="home-card-eyebrow">Personal</span>
        </header>
        <div className="home-personal-body">
          <span className="home-personal-avatar home-personal-avatar--ghost" aria-hidden="true">
            <Plus size={22} strokeWidth={1.5} />
          </span>
          <h3 className="home-personal-name">Your personal TRUST</h3>
          <p className="home-personal-role">Create one to begin</p>
        </div>
      </button>
    );
  }
  return (
    <button
      type="button"
      className="home-card home-card--personal"
      onClick={() => onOpen(personal)}
      aria-label={`Step into your personal TRUST, ${personal.name}`}
    >
      <header className="home-card-head">
        <span className="home-card-eyebrow">Personal</span>
      </header>
      <div className="home-personal-body">
        <span className="home-personal-avatar" aria-hidden="true">
          <BlockAvatar name={personal.name} size={48} />
        </span>
        <h3 className="home-personal-name">{personal.name}</h3>
        <p className="home-personal-role">Your TRUST</p>
      </div>
      <footer className="home-card-foot">
        <span className="home-card-cta">
          Step in
          <ArrowRight size={14} strokeWidth={1.8} />
        </span>
      </footer>
    </button>
  );
}

interface StepIntoTrustCardProps {
  onNewTrust: () => void;
  onBrowseBlueprints: () => void;
}

function StepIntoTrustCard({ onNewTrust, onBrowseBlueprints }: StepIntoTrustCardProps) {
  return (
    <article className="home-card home-card--step">
      <header className="home-card-head">
        <span className="home-card-eyebrow">New</span>
      </header>
      <div className="home-step-body">
        <h3 className="home-step-title">Step into a TRUST.</h3>
        <p className="home-step-hint">Start your own or use a blueprint.</p>
      </div>
      <div className="home-step-actions">
        <button type="button" className="home-step-btn home-step-btn--primary" onClick={onNewTrust}>
          <span className="home-step-btn-icon">
            <Plus size={16} strokeWidth={1.8} />
          </span>
          <span className="home-step-btn-label">New TRUST</span>
        </button>
        <button type="button" className="home-step-btn" onClick={onBrowseBlueprints}>
          <span className="home-step-btn-label">Browse blueprints</span>
          <span className="home-step-btn-icon">
            <ArrowRight size={16} strokeWidth={1.8} />
          </span>
        </button>
      </div>
    </article>
  );
}

interface AllTrustsCardProps {
  others: ReadonlyArray<Trust>;
  totalCount: number;
  onViewAll: () => void;
  onPick: (trust: Trust) => void;
}

function AllTrustsCard({ others, totalCount, onViewAll, onPick }: AllTrustsCardProps) {
  const previewAvatars = others.slice(0, ALL_TRUSTS_AVATAR_LIMIT);
  const overflow = Math.max(0, others.length - previewAvatars.length);

  return (
    <article className="home-card home-card--all">
      <header className="home-card-head">
        <span className="home-card-eyebrow">All</span>
        <button type="button" className="home-card-link" onClick={onViewAll}>
          View all
          <ArrowRight size={14} strokeWidth={1.8} />
        </button>
      </header>
      <div className="home-all-body">
        <h3 className="home-all-title">
          {totalCount === 0 ? "No TRUSTs yet" : `${totalCount} TRUST${totalCount === 1 ? "" : "s"}`}
        </h3>
        <p className="home-all-hint">
          {others.length === 0 ? "Just your personal one for now." : "Step into another context."}
        </p>
      </div>
      {previewAvatars.length > 0 ? (
        <ul className="home-all-avatars">
          {previewAvatars.map((t) => (
            <li key={t.id} className="home-all-avatar-item">
              <button
                type="button"
                className="home-all-avatar-btn"
                onClick={() => onPick(t)}
                aria-label={`Step into ${t.name}`}
                title={t.name}
              >
                <BlockAvatar name={t.name} size={32} />
              </button>
            </li>
          ))}
          {overflow > 0 && (
            <li className="home-all-avatar-item">
              <button
                type="button"
                className="home-all-avatar-more"
                onClick={onViewAll}
                aria-label={`See ${overflow} more TRUST${overflow === 1 ? "" : "s"}`}
              >
                +{overflow}
              </button>
            </li>
          )}
        </ul>
      ) : (
        <div className="home-all-empty" aria-hidden="true">
          <Users size={20} strokeWidth={1.4} />
        </div>
      )}
    </article>
  );
}
