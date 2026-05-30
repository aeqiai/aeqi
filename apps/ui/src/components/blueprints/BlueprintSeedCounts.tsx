import type { SingleBlueprint } from "@/lib/types";
import { countBlueprintStructures } from "@/lib/blueprintStructures";

interface BlueprintSeedCountsProps {
  template: SingleBlueprint;
}

/**
 * Compact summary of what a Blueprint seeds — placed directly under the
 * hero so the reader gets information scent before the org chart. Each
 * pill is a count + label. The role count comes from declared
 * `seed_roles` when present (the canonical structure), falling back to
 * one default role plus `seed_agents` for un-ported blueprints. Agent
 * count always includes the default agent so a one-agent starter never
 * reads as empty.
 */
export function BlueprintSeedCounts({ template }: BlueprintSeedCountsProps) {
  const declaredRoles = template.seed_roles?.length ?? 0;
  const totalAgents = (template.seed_agents?.length ?? 0) + 1;
  const structureCount = countBlueprintStructures(template);
  const seedViews = template.seed_views?.length ?? 0;
  const pills: Array<[label: string, value: number]> = [
    ...(structureCount > 1 ? ([["Structures", structureCount]] as Array<[string, number]>) : []),
    ["Roles", declaredRoles > 0 ? declaredRoles : totalAgents],
    ["Agents", totalAgents],
    ...(seedViews > 0 ? ([["Views", seedViews]] as Array<[string, number]>) : []),
    ["Quests", template.seed_quests?.length ?? 0],
    ["Ideas", template.seed_ideas?.length ?? 0],
    ["Events", template.seed_events?.length ?? 0],
  ];
  return (
    <ul className="bp-summary-pills" role="list" aria-label="What this blueprint seeds">
      {pills.map(([label, value]) => (
        <li key={label} className="bp-summary-pill">
          <span className="bp-summary-pill-value">{value}</span>
          <span className="bp-summary-pill-label">{label}</span>
        </li>
      ))}
    </ul>
  );
}
