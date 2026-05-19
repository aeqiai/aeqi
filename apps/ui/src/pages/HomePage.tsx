import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import BlockAvatar from "@/components/BlockAvatar";
import { useUIStore } from "@/store/ui";
import { useEntities, useActiveEntity } from "@/queries/entities";

/**
 * Network — `/network`. The operating-context surface. Shows the trust
 * the user is currently in as a big visual anchor (avatar + name + role)
 * and provides the means to switch below.
 *
 * Page composition:
 *   1. Current trust hero — large BlockAvatar + trust name in display
 *      type + role label. Tells the user where they are.
 *   2. Switcher — quiet grid of OTHER trusts. The current one isn't
 *      repeated; it's the anchor above. Trailing "+ New trust" tile
 *      makes creation a peer to selection.
 *
 * Per .impeccable.md: no gradients, no decorative motion. The feel
 * comes from composition, scale, and restraint.
 */
export default function HomePage() {
  const navigate = useNavigate();
  const activeEntityId = useUIStore((s) => s.activeEntity);
  const activeEntity = useActiveEntity(activeEntityId);
  const entities = useEntities();

  // Stub: the runtime doesn't surface a "current acting role" yet. When
  // it does, this resolves to a real value per (user × trust).
  const currentRole = "Director";

  const otherContexts = useMemo(
    () =>
      entities
        .filter((e) => e.id !== activeEntityId)
        .map((entity) => ({
          id: entity.id,
          role: "Director",
          trust: entity.name,
          href: `/trust/${encodeURIComponent(entity.id)}`,
        })),
    [entities, activeEntityId],
  );

  return (
    <div className="network-page">
      <header className="network-anchor">
        {activeEntity ? (
          <>
            <span className="network-anchor-avatar">
              <BlockAvatar name={activeEntity.name} size={112} />
            </span>
            <div className="network-anchor-text">
              <p className="network-anchor-eyebrow">Currently operating</p>
              <h1 className="network-anchor-trust">{activeEntity.name}</h1>
              <p className="network-anchor-role">as {currentRole}</p>
            </div>
          </>
        ) : (
          <div className="network-anchor-text network-anchor-text--empty">
            <p className="network-anchor-eyebrow">No active context</p>
            <h1 className="network-anchor-trust">Step into a trust</h1>
            <p className="network-anchor-role">Pick or create one below.</p>
          </div>
        )}
      </header>

      <section className="network-switcher" aria-label="Other contexts">
        <p className="network-switcher-label">
          {otherContexts.length > 0 ? "Switch context" : "Start something new"}
        </p>
        <div className="network-switcher-grid">
          {otherContexts.map((ctx) => (
            <button
              key={ctx.id}
              type="button"
              className="network-tile"
              onClick={() => navigate(ctx.href)}
              aria-label={`${ctx.role} at ${ctx.trust}`}
            >
              <span className="network-tile-avatar">
                <BlockAvatar name={ctx.trust} size={56} />
              </span>
              <span className="network-tile-trust">{ctx.trust}</span>
              <span className="network-tile-role">{ctx.role}</span>
            </button>
          ))}
          <button
            type="button"
            className="network-tile network-tile--create"
            onClick={() => navigate("/launch")}
            aria-label="Create a new trust"
          >
            <span className="network-tile-avatar network-tile-avatar--ghost">
              <Plus size={22} strokeWidth={1.5} />
            </span>
            <span className="network-tile-trust">New trust</span>
            <span className="network-tile-role">Start fresh</span>
          </button>
        </div>
      </section>
    </div>
  );
}
