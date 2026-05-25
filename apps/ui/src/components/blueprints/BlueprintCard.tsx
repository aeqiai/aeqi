import { memo } from "react";
import { Link } from "react-router-dom";
import { blueprintId } from "@/lib/blueprintId";
import { DEFAULT_BLUEPRINT_SLUG } from "@/lib/blueprintDefaults";
import { countBlueprintStructures } from "@/lib/blueprintStructures";
import { Card } from "@/components/ui";
import type { SingleBlueprint, BlueprintTemplate } from "@/lib/types";

interface BlueprintCardProps {
  template: SingleBlueprint;
  importTargetSuffix?: string;
}

/** On-chain TRUST modules included by template type. */
const ONCHAIN_MODULES: Record<BlueprintTemplate, string> = {
  entity: "Role · Budget · Token · Vesting · Funding",
  venture: "Role · Budget · Token · Vesting · Funding · Uniswap · UniFutures",
  foundation: "Role · Budget · Governance",
  fund: "Role · Budget · Token · Fund · Governance",
};

/** Human-readable runtime summary: "N agents · M events · K ideas · J quests".
 *  Counts the default agent plus declared seed agents. */
function formatRuntimeLine(t: SingleBlueprint): string {
  const parts: string[] = [];
  const a = (t.seed_agents?.length ?? 0) + 1;
  const e = t.seed_events?.length ?? 0;
  const i = t.seed_ideas?.length ?? 0;
  const q = t.seed_quests?.length ?? 0;
  const structures = countBlueprintStructures(t);
  parts.push(`${a} ${a === 1 ? "agent" : "agents"}`);
  if (structures > 1) parts.push(`${structures} structures`);
  if (e > 0) parts.push(`${e} ${e === 1 ? "event" : "events"}`);
  if (i > 0) parts.push(`${i} ${i === 1 ? "idea" : "ideas"}`);
  if (q > 0) parts.push(`${q} ${q === 1 ? "quest" : "quests"}`);
  return parts.join(" · ");
}

/**
 * Catalog card on `/blueprints`. Shows:
 * - Name + tagline (unchanged)
 * - TRUST shell inclusion list derived from `template`
 * - Operating seed counts (agents · events · ideas · quests)
 *
 * No bespoke colors. No accents. Pure typography hierarchy via design-
 * system tokens. Card surface, hover, radius from the `Card` primitive.
 */
function BlueprintCardImpl({ template, importTargetSuffix = "" }: BlueprintCardProps) {
  const id = blueprintId(template);
  const isDefault = id === DEFAULT_BLUEPRINT_SLUG;
  const onchainModules = template.template ? ONCHAIN_MODULES[template.template] : null;
  const runtimeLine = formatRuntimeLine(template);

  return (
    <Link
      to={`/blueprints/${encodeURIComponent(id)}${importTargetSuffix}`}
      className="bp-card-link"
      role="listitem"
      aria-label={`${template.name} blueprint${template.tagline ? ` — ${template.tagline}` : ""}`}
    >
      <Card variant="default" padding="md" interactive className="bp-card">
        <h3 className="bp-card-name">
          {template.name}
          {isDefault && <span className="bp-card-default-mark"> · Default</span>}
        </h3>
        {template.tagline && <p className="bp-card-tagline">{template.tagline}</p>}
        <div className="bp-card-inclusions">
          {onchainModules && (
            <div className="bp-card-inclusion-row">
              <span className="bp-card-inclusion-label">TRUST shell</span>
              <span className="bp-card-inclusion-value">{onchainModules}</span>
            </div>
          )}
          <div className="bp-card-inclusion-row">
            <span className="bp-card-inclusion-label">Operating seed</span>
            <span className="bp-card-inclusion-value">{runtimeLine}</span>
          </div>
        </div>
      </Card>
    </Link>
  );
}

export const BlueprintCard = memo(BlueprintCardImpl);
