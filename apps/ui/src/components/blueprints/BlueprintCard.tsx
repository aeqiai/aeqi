import { memo } from "react";
import { Link } from "react-router-dom";
import type { CompanyTemplate } from "@/lib/types";

interface BlueprintCardProps {
  template: CompanyTemplate;
  /** Animation index — used by parent grid for staggered reveal. */
  index?: number;
}

/**
 * Grid card on `/blueprints`. The whole card is a navigation link to
 * `/blueprints/:slug` — selection no longer mutates page state, the URL
 * is the source of truth for "which blueprint is open."
 */
function BlueprintCardImpl({ template, index = 0 }: BlueprintCardProps) {
  const counts = {
    a: template.seed_agents?.length ?? 0,
    i: template.seed_ideas?.length ?? 0,
    e: template.seed_events?.length ?? 0,
    q: template.seed_quests?.length ?? 0,
  };
  const style = index < 10 ? { animationDelay: `${index * 40}ms` } : { animationDelay: "400ms" };
  return (
    <Link
      to={`/blueprints/${encodeURIComponent(template.slug)}`}
      role="listitem"
      className="bp-card"
      style={style}
    >
      <h3 className="bp-card-name">{template.name}</h3>
      {template.tagline && <p className="bp-card-tagline">{template.tagline}</p>}
      <div className="bp-card-monograms" aria-label="Seed counts">
        {(["a", "i", "e", "q"] as const).map((l) => (
          <span key={l} className="bp-card-mono">
            <span className="bp-card-mono-l">{l}</span>
            <span className="bp-card-mono-n">{counts[l]}</span>
          </span>
        ))}
      </div>
    </Link>
  );
}

export const BlueprintCard = memo(BlueprintCardImpl);
