import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Inbox, Store, Landmark, Plus } from "lucide-react";
import { useAuthStore } from "@/store/auth";
import { useEntities } from "@/queries/entities";

/**
 * Start — the welcome / first-experience surface. Distinct from `/` (the
 * dominion picker), this is where a new user is *arrived*: a wide hero
 * image at the top, a personalised greeting, and four preview cards for
 * the primary destinations they'll learn to use.
 *
 * Per the user's design direction (2026-05-19): the page should feel
 * like entering a new world — cinematic but quiet. The hero image is the
 * single editorial gesture; everything below stays inside the design
 * system's restraint (cards in pure-neutral, no decorative effects).
 *
 * Cards:
 *   1. Start a trust   → /launch
 *   2. Your inbox      → /inbox  (preview: unread count when wired)
 *   3. Economy         → /economy (preview: marketplace pulse later)
 *   4. Your network    → /  (preview: trust count when wired)
 */
export default function StartPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const entities = useEntities();

  const actorName = useMemo(
    () => user?.name?.trim() || user?.email?.split("@")[0] || "friend",
    [user],
  );

  const trustCount = entities.length;

  return (
    <div className="start-page">
      <header className="start-page-hero">
        <img
          src="/welcome/start-hero.png"
          alt=""
          className="start-page-hero-image"
          aria-hidden="true"
        />
        <div className="start-page-hero-overlay">
          <h1 className="start-page-hero-title">Welcome, {actorName}.</h1>
          <p className="start-page-hero-subtitle">
            You&apos;ve arrived. Pick a place to begin — start something of your own, or step into
            what&apos;s already moving.
          </p>
        </div>
      </header>

      <section className="start-page-grid" aria-label="Where to begin">
        <button
          type="button"
          className="start-page-card start-page-card--primary"
          onClick={() => navigate("/launch")}
        >
          <span className="start-page-card-icon">
            <Plus size={20} strokeWidth={1.5} />
          </span>
          <span className="start-page-card-title">Start a trust</span>
          <span className="start-page-card-desc">
            Spin up your own — pick a blueprint or start blank.
          </span>
          <span className="start-page-card-action">Get started →</span>
        </button>

        <button type="button" className="start-page-card" onClick={() => navigate("/inbox")}>
          <span className="start-page-card-icon">
            <Inbox size={20} strokeWidth={1.5} />
          </span>
          <span className="start-page-card-title">Your inbox</span>
          <span className="start-page-card-desc">
            Approvals, signatures, and proposals waiting on you.
          </span>
          <span className="start-page-card-action">Open inbox →</span>
        </button>

        <button type="button" className="start-page-card" onClick={() => navigate("/economy")}>
          <span className="start-page-card-icon">
            <Store size={20} strokeWidth={1.5} />
          </span>
          <span className="start-page-card-title">The economy</span>
          <span className="start-page-card-desc">
            Marketplace, inference, and stake activity across the network.
          </span>
          <span className="start-page-card-action">Browse →</span>
        </button>

        <button type="button" className="start-page-card" onClick={() => navigate("/identity")}>
          <span className="start-page-card-icon">
            <Landmark size={20} strokeWidth={1.5} />
          </span>
          <span className="start-page-card-title">Your network</span>
          <span className="start-page-card-desc">
            {trustCount > 0
              ? `${trustCount} trust${trustCount === 1 ? "" : "s"} you operate from.`
              : "The trusts you operate from will appear here."}
          </span>
          <span className="start-page-card-action">View network →</span>
        </button>
      </section>
    </div>
  );
}
