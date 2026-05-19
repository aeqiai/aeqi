import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Inbox, Store, Landmark, Plus, Rocket, Bot, PiggyBank, Network } from "lucide-react";
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
 */

type SuggestedBlueprint = {
  label: string;
  blueprintId: string;
  icon: typeof Rocket;
};

const SUGGESTED_BLUEPRINTS: readonly SuggestedBlueprint[] = [
  { label: "Startup Trust", blueprintId: "solo-founder", icon: Rocket },
  { label: "Agentic Company", blueprintId: "aeqi-company", icon: Bot },
  { label: "Investment Vehicle", blueprintId: "index-fund", icon: PiggyBank },
  { label: "Protocol Trust", blueprintId: "aeqi", icon: Network },
];

export default function StartPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const entities = useEntities();

  const actorName = useMemo(
    () => user?.name?.trim() || user?.email?.split("@")[0] || "friend",
    [user],
  );

  // Empty state shows Suggested blueprints (instantly actionable).
  // Once the user has at least one trust, this is their landing again —
  // the suggestions stop being useful and we hide the bottom section.
  const showSuggested = entities.length === 0;

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
            Launch a trust, review what needs approval, or step into the economy already forming
            around you.
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
            Launch a programmable company vehicle with roles, ownership, and agents.
          </span>
          <span className="start-page-card-action">Get started →</span>
        </button>

        <button type="button" className="start-page-card" onClick={() => navigate("/inbox")}>
          <span className="start-page-card-icon">
            <Inbox size={20} strokeWidth={1.5} />
          </span>
          <span className="start-page-card-title">Your inbox</span>
          <span className="start-page-card-desc">
            Approvals, signatures, proposals, and tasks waiting on you.
          </span>
          <span className="start-page-card-action">Open inbox →</span>
        </button>

        <button type="button" className="start-page-card" onClick={() => navigate("/economy")}>
          <span className="start-page-card-icon">
            <Store size={20} strokeWidth={1.5} />
          </span>
          <span className="start-page-card-title">The economy</span>
          <span className="start-page-card-desc">
            Discover trusts, agents, markets, and capital activity.
          </span>
          <span className="start-page-card-action">Browse →</span>
        </button>

        <button type="button" className="start-page-card" onClick={() => navigate("/trust")}>
          <span className="start-page-card-icon">
            <Landmark size={20} strokeWidth={1.5} />
          </span>
          <span className="start-page-card-title">Your trusts</span>
          <span className="start-page-card-desc">
            Step into any trust you operate from — your own, or one you've been invited into.
          </span>
          <span className="start-page-card-action">Open →</span>
        </button>
      </section>

      {showSuggested && (
        <section className="start-page-suggested" aria-label="Suggested blueprints">
          <h2 className="start-page-suggested-title">Suggested blueprints</h2>
          <div className="start-page-suggested-grid">
            {SUGGESTED_BLUEPRINTS.map(({ label, blueprintId, icon: Icon }) => (
              <button
                key={blueprintId}
                type="button"
                className="start-page-blueprint"
                onClick={() => navigate(`/launch/${blueprintId}`)}
              >
                <span className="start-page-blueprint-icon">
                  <Icon size={16} strokeWidth={1.5} />
                </span>
                <span className="start-page-blueprint-label">{label}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
