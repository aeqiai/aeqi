import { useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Plus,
  Inbox as InboxIcon,
  Store,
  ArrowUpRight,
  ArrowRight,
  ArrowDown,
  Users,
  Settings,
} from "lucide-react";
import { useAuthStore } from "@/store/auth";
import { useEntities } from "@/queries/entities";
import { useInboxStore } from "@/store/inbox";
import { entityPath } from "@/lib/entityPath";
import { sessionDeepUrlFromId } from "@/lib/sessionUrl";
import { timeShort } from "@/lib/format";
import { launchPlanById } from "@/lib/pricing";
import BlockAvatar from "@/components/BlockAvatar";
import TrustAvatar from "@/components/TrustAvatar";
import UserAvatar from "@/components/UserAvatar";
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

  // Map trust_id → activity tier from the inbox. This turns the All
  // TRUSTs avatar grid below from a static set of tiles into "live
  // contexts": tiles that carry a status dot when something is moving
  // in that TRUST. Awaiting wins (amber/review) — that's where the
  // user actually has to step in. Any other inbox item promotes the
  // tile to indigo/progress — live but not blocking. Tiles with no
  // inbox signal stay clean. Same dot grammar as the hero-pill and
  // inbox-status rows so the surface reads as one family.
  const trustActivity = useMemo(() => {
    const map = new Map<string, "review" | "progress">();
    for (const it of inboxItems) {
      if (!it.trust_id) continue;
      const prev = map.get(it.trust_id);
      if (it.awaiting_at) {
        map.set(it.trust_id, "review");
      } else if (prev !== "review") {
        map.set(it.trust_id, "progress");
      }
    }
    return map;
  }, [inboxItems]);

  const inboxPreview = inboxItems.slice(0, INBOX_PREVIEW_LIMIT);
  const inboxCount = inboxItems.length;
  const awaitingCount = useMemo(
    () => inboxItems.filter((i) => !!i.awaiting_at).length,
    [inboxItems],
  );
  const planLabel = useMemo(() => {
    if (!user?.subscription_plan) return "Free";
    try {
      return launchPlanById(user.subscription_plan).name;
    } catch {
      return "Free";
    }
  }, [user?.subscription_plan]);
  const trustsLabel = `${entities.length} TRUST${entities.length === 1 ? "" : "s"}`;
  const inboxLabel =
    awaitingCount > 0
      ? `${awaitingCount} awaiting`
      : inboxCount > 0
        ? `${inboxCount} in inbox`
        : "Inbox clear";
  // Hero pill carries the home page's at-a-glance state signal. The inbox
  // stat takes the board status grammar: amber (in_review) when something
  // is awaiting the user, indigo (in_progress) when items are live but not
  // blocked, muted when the inbox is clear. This puts the same dot
  // vocabulary used on the inbox preview rows below into the surface above
  // them, so the pill summary and the per-row dots read as one signal.
  const inboxPillState: "review" | "progress" | "idle" =
    awaitingCount > 0 ? "review" : inboxCount > 0 ? "progress" : "idle";

  return (
    <div className="home-page">
      <header className="home-hero">
        <img src="/welcome/start-hero.png" alt="" className="home-hero-image" aria-hidden="true" />
        <Link
          to="/account"
          className="home-hero-settings"
          aria-label="Open account settings"
          title="Account settings"
        >
          <Settings size={16} strokeWidth={1.6} />
        </Link>
        <div className="home-hero-overlay">
          <div className="home-hero-identity">
            <span className="home-hero-avatar" aria-hidden="true">
              <UserAvatar name={actorName} size={56} src={user?.avatar_url} />
            </span>
            <div className="home-hero-text">
              <p className="home-hero-eyebrow">Welcome back</p>
              <h1 className="home-hero-title">{actorName}</h1>
            </div>
          </div>
        </div>
        {/* Hero pill is a status snapshot of the user's TRUSTs and inbox.
            First-touch (no entities yet) has no status to snapshot —
            "0 TRUSTs · Inbox clear · Free plan" reads as a deficit
            ledger, not a welcome. Suppress it until the user has at
            least one TRUST. The empty-state hint chip (--hint variant)
            takes the same bottom-left anchor so the hero composition
            stays balanced — without it, the greeting and gear float at
            top with no answering weight in the bottom-left, and the
            mask-faded foreground reads as unfinished rather than
            quiet. Forward-pointing copy + downward arrow hand the eye
            off to PersonalTrustCard's create-your-first-TRUST CTA
            below instead of duplicating it. */}
        {entities.length > 0 ? (
          <div className="home-hero-pill" role="status" aria-label="Account snapshot">
            <span className="home-hero-pill-stat">{trustsLabel}</span>
            <span className="home-hero-pill-sep" aria-hidden>
              ·
            </span>
            <span className="home-hero-pill-stat home-hero-pill-stat--inbox">
              <span
                className={`home-hero-pill-dot home-hero-pill-dot--${inboxPillState}`}
                aria-hidden="true"
              />
              {inboxLabel}
            </span>
            <span className="home-hero-pill-sep" aria-hidden>
              ·
            </span>
            <span className="home-hero-pill-stat">{planLabel} plan</span>
          </div>
        ) : (
          <div className="home-hero-pill home-hero-pill--hint" aria-hidden="true">
            <span className="home-hero-pill-stat">Let&rsquo;s set up your first TRUST</span>
            <ArrowDown size={12} strokeWidth={1.8} aria-hidden="true" />
          </div>
        )}
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
          activity={trustActivity}
          onViewAll={() => navigate("/trust")}
          onPick={(t) => navigate(entityPath(t))}
        />
      </section>

      <section className="home-row-two" aria-label="Inbox and economy">
        {/* First-touch (no entities) mutes the Inbox card via a modifier
            class. The empty-state circle + display-font headline + hint
            paragraph compete with the trust-row CTA for visual gravity
            during onboarding — but hiding the card collapses the
            two-column row and orphans Economy. Muting keeps the
            structural slot (so users learn "this is where inbox lives")
            without staging an editorial empty-state moment they can't
            act on yet. Once the user creates a TRUST the modifier
            drops and the card returns to its normal weight. */}
        <article
          className={`home-card home-card--inbox${
            entities.length === 0 ? " home-card--quiet" : ""
          }`}
        >
          <header className="home-card-head">
            <span className="home-card-icon">
              <InboxIcon size={16} strokeWidth={1.5} />
            </span>
            <span className="home-card-title">Inbox</span>
            {/* Meta string reuses `inboxLabel` from the hero pill so the
                card head and the pill stat read as one signal — same
                three-state vocabulary (N awaiting / N in inbox / Inbox
                clear), same dot color. Replaces the earlier "N waiting"
                phrasing, which read the total count as "waiting" even
                when nothing actually awaited the user. Suppressed during
                first-touch — without a TRUST the inbox can't carry any
                signal, so the meta stat would just repeat "Inbox clear"
                against a card already muted. */}
            {entities.length > 0 && (
              <span className="home-card-meta">
                <span
                  className={`home-card-meta-dot home-card-meta-dot--${inboxPillState}`}
                  aria-hidden="true"
                />
                {inboxLabel}
              </span>
            )}
            <button type="button" className="home-card-link" onClick={() => navigate("/inbox")}>
              View all
              <ArrowRight size={14} strokeWidth={1.8} />
            </button>
          </header>
          {inboxPreview.length > 0 ? (
            <ul className="home-inbox-list">
              {inboxPreview.map((item) => {
                // Subject is the headline. Use the awaiting subject when
                // present (decision-request shape), else fall back to a
                // session name or the first 80 chars of the agent's last
                // message. The preview line below is suppressed when the
                // subject already comes from the agent's message — they
                // duplicate in that case. Keeping only the case where the
                // subject is a session/awaiting label and the message adds
                // additional context.
                const subject =
                  item.awaiting_subject ||
                  item.session_name ||
                  item.last_agent_message?.slice(0, 80) ||
                  "Untitled session";
                const subjectFromMessage =
                  !item.awaiting_subject && !item.session_name && !!item.last_agent_message;
                const preview = subjectFromMessage
                  ? ""
                  : item.last_agent_message?.replace(/\s+/g, " ").trim() || "";
                const from = item.agent_name || "Agent";
                const time = timeShort(item.awaiting_at || item.last_active);
                // Status uses the board-locked accent grammar so the family
                // reads coherent across primitives: awaiting → in_review
                // (amber) makes the rows that actually need the user pop;
                // every other row stays in_progress (indigo) as "live but
                // not blocked on you". The "N awaiting" stat in the hero
                // pill now has a literal visual companion below it.
                const status = item.awaiting_at ? "in_review" : "in_progress";
                const statusLabel = item.awaiting_at ? "Awaiting you" : "Active";
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
                      <span
                        className={`home-inbox-status home-inbox-status--${status}`}
                        aria-label={statusLabel}
                        title={statusLabel}
                      />
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
          ) : entities.length === 0 ? (
            // First-touch: one quiet line instead of the editorial empty
            // state. No filled icon puck, no display-font headline — both
            // pull attention the user can't act on yet. Single line of
            // secondary copy keeps the card's vertical slot honest
            // without staging a competing moment.
            <div className="home-inbox-empty home-inbox-empty--quiet">
              <p className="home-inbox-empty-hint">
                Approvals and proposals appear here once your TRUST is live.
              </p>
            </div>
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
        <div className="home-personal-body">
          <span className="home-personal-avatar home-personal-avatar--ghost" aria-hidden="true">
            <Plus size={26} strokeWidth={1.5} />
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
      <div className="home-personal-body">
        <span className="home-personal-avatar" aria-hidden="true">
          <TrustAvatar name={personal.name} size={64} />
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
  activity: ReadonlyMap<string, "review" | "progress">;
  onViewAll: () => void;
  onPick: (trust: Trust) => void;
}

function AllTrustsCard({ others, activity, onViewAll, onPick }: AllTrustsCardProps) {
  const previewAvatars = others.slice(0, ALL_TRUSTS_AVATAR_LIMIT);
  const overflow = Math.max(0, others.length - previewAvatars.length);
  // Promote the eyebrow when any visible tile has activity — gives the
  // card a single at-a-glance signal even when the per-tile dots are
  // small. Review wins over progress, mirroring the hero pill.
  const eyebrowState: "review" | "progress" | null = previewAvatars.reduce<
    "review" | "progress" | null
  >((acc, t) => {
    const s = activity.get(t.id);
    if (s === "review") return "review";
    if (s === "progress" && acc !== "review") return "progress";
    return acc;
  }, null);

  // First-touch parity with the Inbox card (c8). When the user has no
  // other TRUSTs to step into, the "No other TRUSTs" headline + empty
  // Users-icon circle stages an empty state the user can't act on yet
  // — the same anti-pattern muted on Inbox. Apply `home-card--quiet`
  // so the satellite recedes and StepIntoTrustCard (the actual CTA in
  // this row) becomes the visual focal point during onboarding. Once
  // a second TRUST exists, the modifier drops and the card returns to
  // full weight. Reordering the grid was the alternative; muting wins
  // because the 2fr/1fr/1fr asymmetry of `.home-row-trusts` is the
  // anchor pattern (Personal = "where you live") — disturbing the
  // column order to compensate for a transient state would forfeit
  // that signal.
  const isQuiet = others.length === 0;
  return (
    <article className={`home-card home-card--all${isQuiet ? " home-card--quiet" : ""}`}>
      <header className="home-card-head">
        <span className="home-card-eyebrow home-all-eyebrow">
          {eyebrowState && (
            <span
              className={`home-all-eyebrow-dot home-all-eyebrow-dot--${eyebrowState}`}
              aria-hidden="true"
            />
          )}
          All
        </span>
        <button type="button" className="home-card-link" onClick={onViewAll}>
          View all
          <ArrowRight size={14} strokeWidth={1.8} />
        </button>
      </header>
      <div className="home-all-body">
        <h3 className="home-all-title">
          {others.length === 0 ? "No other TRUSTs" : "Switch context"}
        </h3>
        <p className="home-all-hint">
          {others.length === 0
            ? "Just your personal one for now."
            : `${others.length} other${others.length === 1 ? "" : "s"} to step into.`}
        </p>
      </div>
      {previewAvatars.length > 0 ? (
        <ul className="home-all-avatars">
          {previewAvatars.map((t) => {
            const state = activity.get(t.id);
            const label =
              state === "review" ? "awaiting you" : state === "progress" ? "active" : "";
            return (
              <li key={t.id} className="home-all-avatar-item">
                <button
                  type="button"
                  className="home-all-avatar-btn"
                  onClick={() => onPick(t)}
                  aria-label={label ? `Step into ${t.name} — ${label}` : `Step into ${t.name}`}
                  title={label ? `${t.name} · ${label}` : t.name}
                >
                  <TrustAvatar name={t.name} size={32} />
                  {state && (
                    <span
                      className={`home-all-avatar-dot home-all-avatar-dot--${state}`}
                      aria-hidden="true"
                    />
                  )}
                </button>
              </li>
            );
          })}
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
