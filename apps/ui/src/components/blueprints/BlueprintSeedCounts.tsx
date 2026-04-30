import type { CompanyTemplate } from "@/lib/types";

interface BlueprintSeedCountsProps {
  template: CompanyTemplate;
}

const LABELS = {
  roles: "Roles",
  agents: "Agents",
  ideas: "Ideas",
  events: "Events",
  quests: "Quests",
} as const;

export function BlueprintSeedCounts({ template }: BlueprintSeedCountsProps) {
  // Today seed_agents is the source for both — each entry IS a
  // role + default occupant. When the schema gains explicit
  // seed_roles, the role count reads from there. The agent count
  // always reflects the seeded identities (the workforce). 1:1
  // today, may diverge later (e.g. one agent template → multiple
  // role instances).
  const seedCount = template.seed_agents?.length ?? 0;
  const counts = {
    roles: seedCount,
    agents: seedCount,
    ideas: template.seed_ideas?.length ?? 0,
    events: template.seed_events?.length ?? 0,
    quests: template.seed_quests?.length ?? 0,
  };
  return (
    <ul className="bp-detail-monograms" aria-label="What this blueprint seeds">
      {(Object.keys(LABELS) as Array<keyof typeof LABELS>).map((key) => (
        <li key={key}>
          <span className="n">{counts[key]}</span> {LABELS[key]}
        </li>
      ))}
    </ul>
  );
}
