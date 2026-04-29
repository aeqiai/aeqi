import { memo } from "react";
import { Link } from "react-router-dom";
import { DEFAULT_BLUEPRINT_SLUG } from "@/lib/blueprintDefaults";
import { Card } from "@/components/ui";
import type { CompanyTemplate } from "@/lib/types";

interface BlueprintCardProps {
  template: CompanyTemplate;
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
 * Catalog card on `/blueprints`. Uses the shared `Card` primitive in
 * `interactive` mode so hover, border, radius, padding, and surface
 * tone come from the design system — no bespoke colors, no per-card
 * accents, no extra hover gestures. Pure typography hierarchy:
 * name → tagline → meta. The "Default" marker is a quiet text suffix
 * in the meta line, not a pill.
 */
function BlueprintCardImpl({ template }: BlueprintCardProps) {
  const isDefault = template.slug === DEFAULT_BLUEPRINT_SLUG;
  const meta = formatSeedMeta(template);
  const fullMeta = isDefault ? `${meta} · Default` : meta;

  return (
    <Link
      to={`/blueprints/${encodeURIComponent(template.slug)}`}
      className="bp-card-link"
      role="listitem"
      aria-label={`${template.name} blueprint${template.tagline ? ` — ${template.tagline}` : ""}`}
    >
      <Card variant="default" padding="md" interactive className="bp-card">
        <h3 className="bp-card-name">{template.name}</h3>
        {template.tagline && <p className="bp-card-tagline">{template.tagline}</p>}
        <p className="bp-card-meta">{fullMeta}</p>
      </Card>
    </Link>
  );
}

export const BlueprintCard = memo(BlueprintCardImpl);
