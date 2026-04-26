import { memo } from "react";
import { Link } from "react-router-dom";
import { DEFAULT_TEMPLATE_SLUG } from "@/lib/templateFixtures";
import type { CompanyTemplate } from "@/lib/types";

interface BlueprintCardProps {
  template: CompanyTemplate;
  /** Animation index — used by parent grid for staggered reveal. */
  index?: number;
}

/** Compact human meta — "2 agents · 1 idea · 1 event", zeros skipped. */
function formatSeedMeta(t: CompanyTemplate): string {
  const parts: string[] = [];
  const a = t.seed_agents?.length ?? 0;
  const i = t.seed_ideas?.length ?? 0;
  const e = t.seed_events?.length ?? 0;
  const q = t.seed_quests?.length ?? 0;
  // Always count the root agent so cards aren't ever empty-looking.
  const totalAgents = 1 + a;
  parts.push(`${totalAgents} ${totalAgents === 1 ? "agent" : "agents"}`);
  if (i > 0) parts.push(`${i} ${i === 1 ? "idea" : "ideas"}`);
  if (e > 0) parts.push(`${e} ${e === 1 ? "event" : "events"}`);
  if (q > 0) parts.push(`${q} ${q === 1 ? "quest" : "quests"}`);
  return parts.join(" · ");
}

/**
 * Catalog card on `/blueprints`. Restraint over flourish — one
 * accent-colored chip (the root agent's color, if any) anchors the
 * identity; everything else is typography. Hovering surfaces the
 * Blueprint's identity by shifting the border to the root color.
 *
 * The whole card is a navigation link; URL is source of truth for
 * "which Blueprint is open" so the click → detail-page transition
 * gets browser back/forward + deep-link semantics for free.
 */
function BlueprintCardImpl({ template, index = 0 }: BlueprintCardProps) {
  const isDefault = template.slug === DEFAULT_TEMPLATE_SLUG;
  const accent = template.root?.color;
  const meta = formatSeedMeta(template);

  // Stagger first 10 cards; clamp the rest at 400ms so a long catalog
  // doesn't crawl in over multiple seconds.
  const animationDelay = index < 10 ? `${index * 40}ms` : "400ms";

  return (
    <Link
      to={`/blueprints/${encodeURIComponent(template.slug)}`}
      role="listitem"
      className="bp-card"
      style={
        {
          animationDelay,
          // CSS custom property the hover state uses to tint the
          // border. Falls back to var(--text-primary) when no accent.
          ...(accent ? { ["--bp-card-accent" as string]: accent } : {}),
        } as React.CSSProperties
      }
      aria-label={`${template.name} blueprint${template.tagline ? ` — ${template.tagline}` : ""}`}
    >
      <div className="bp-card-head">
        <span
          className="bp-card-dot"
          aria-hidden="true"
          style={accent ? { background: accent } : undefined}
        />
        <h3 className="bp-card-name">{template.name}</h3>
        {isDefault && <span className="bp-card-default">Default</span>}
      </div>

      {template.tagline && <p className="bp-card-tagline">{template.tagline}</p>}

      <p className="bp-card-meta">{meta}</p>
    </Link>
  );
}

export const BlueprintCard = memo(BlueprintCardImpl);
