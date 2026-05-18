import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import BlockAvatar from "@/components/BlockAvatar";
import UserAvatar from "@/components/UserAvatar";
import { useAuthStore } from "@/store/auth";
import { useEntities } from "@/queries/entities";

/**
 * Home — the root `/` surface. THIS page IS the network map / identity
 * selection: every authed visit lands here to pick which identity (actor
 * × role × trust tuple) to operate as, or create a new one. There is no
 * separate "view network map" destination — the root is it.
 *
 * Two affordances only: SELECT a context tile, or CREATE via the "+ New
 * trust" tile (in the grid, peer to selection — not a separate button).
 *
 * Visual intent (ethereal / character-selection): centred anchor avatar
 * + personal greeting in display type, generous gaps, soft hover lift.
 * Per .impeccable.md: no hairlines, no gradients, no animations beyond
 * 0.12s ease — the feel comes from composition and whitespace.
 *
 * Empty state collapses the page to a single inviting hero card so a
 * brand-new user isn't met with an awkward lone "+" tile.
 *
 * MVP data: actor = the signed-in user, trust = each entity from
 * `useEntities()`, role = stub label pending a runtime per-user × per-
 * trust role surface.
 */
function timeAwareGreeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function HomePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const entities = useEntities();

  const actorName = useMemo(
    () => user?.name?.trim() || user?.email?.split("@")[0] || "friend",
    [user],
  );
  const greeting = useMemo(timeAwareGreeting, []);

  const contexts = useMemo(
    () =>
      entities.map((entity) => ({
        id: entity.id,
        actor: actorName,
        role: "Director",
        trust: entity.name,
        href: `/trust/${encodeURIComponent(entity.id)}`,
      })),
    [entities, actorName],
  );

  const hasContexts = contexts.length > 0;

  return (
    <div className="home-picker">
      <div className="home-picker-anchor">
        <span className="home-picker-anchor-avatar">
          <UserAvatar name={actorName} src={user?.avatar_url} size={72} />
        </span>
        <h1 className="home-picker-greeting">
          {greeting}, {actorName}.
        </h1>
      </div>

      {hasContexts ? (
        <>
          <div className="home-picker-grid" role="list">
            {contexts.map((ctx) => (
              <button
                key={ctx.id}
                type="button"
                role="listitem"
                className="home-picker-node"
                onClick={() => navigate(ctx.href)}
                aria-label={`${ctx.actor}, ${ctx.role} at ${ctx.trust}`}
              >
                <span className="home-picker-node-avatar">
                  <BlockAvatar name={ctx.trust} size={72} />
                </span>
                <span className="home-picker-node-actor">{ctx.actor}</span>
                <span className="home-picker-node-context">
                  {ctx.role} · {ctx.trust}
                </span>
              </button>
            ))}
            <button
              type="button"
              role="listitem"
              className="home-picker-node home-picker-node--create"
              onClick={() => navigate("/launch")}
              aria-label="Create a new trust"
            >
              <span className="home-picker-node-avatar home-picker-node-avatar--ghost">
                <Plus size={28} strokeWidth={1.5} />
              </span>
              <span className="home-picker-node-actor">New trust</span>
              <span className="home-picker-node-context">Start something fresh</span>
            </button>
          </div>
          <footer className="home-picker-footer">
            <button
              type="button"
              className="home-picker-link"
              onClick={() => navigate("/blueprints")}
            >
              Browse blueprints
            </button>
          </footer>
        </>
      ) : (
        <button
          type="button"
          className="home-picker-hero"
          onClick={() => navigate("/launch")}
          aria-label="Create your first trust"
        >
          <span className="home-picker-hero-icon">
            <Plus size={36} strokeWidth={1.5} />
          </span>
          <span className="home-picker-hero-title">Create your first trust</span>
          <span className="home-picker-hero-desc">
            A trust is the unit you operate from — ownership, governance, and execution all live
            inside one. Pick a blueprint or start from scratch.
          </span>
          <span className="home-picker-hero-action">
            Get started
            <span aria-hidden="true">→</span>
          </span>
        </button>
      )}
    </div>
  );
}
