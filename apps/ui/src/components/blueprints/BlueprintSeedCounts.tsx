import type { CompanyTemplate } from "@/lib/types";

interface BlueprintSeedCountsProps {
  template: CompanyTemplate;
}

const LABELS = {
  agents: "Agents",
  ideas: "Ideas",
  events: "Events",
  quests: "Quests",
} as const;

export function BlueprintSeedCounts({ template }: BlueprintSeedCountsProps) {
  const counts = {
    agents: template.seed_agents?.length ?? 0,
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
