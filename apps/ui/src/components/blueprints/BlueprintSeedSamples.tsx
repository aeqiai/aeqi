import type { CompanyTemplate } from "@/lib/types";

interface BlueprintSeedSamplesProps {
  template: CompanyTemplate;
  /** How many of each kind to show. Defaults match the previous side-pane density. */
  eventLimit?: number;
  ideaLimit?: number;
  questLimit?: number;
}

export function BlueprintSeedSamples({
  template,
  eventLimit = 3,
  ideaLimit = 3,
  questLimit = 2,
}: BlueprintSeedSamplesProps) {
  const events = (template.seed_events ?? []).slice(0, eventLimit);
  const ideas = (template.seed_ideas ?? []).slice(0, ideaLimit);
  const quests = (template.seed_quests ?? []).slice(0, questLimit);
  if (events.length === 0 && ideas.length === 0 && quests.length === 0) return null;
  return (
    <div className="bp-detail-samples">
      {events.length > 0 && (
        <section className="bp-detail-sample-block">
          <h3 className="bp-detail-sample-title">Events that fire</h3>
          <ul className="bp-detail-sample-list">
            {events.map((e, i) => (
              <li key={i}>
                <code className="bp-detail-sample-pattern">{e.pattern}</code>
                {e.name && <span className="bp-detail-sample-name"> · {e.name}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {ideas.length > 0 && (
        <section className="bp-detail-sample-block">
          <h3 className="bp-detail-sample-title">Ideas seeded</h3>
          <ul className="bp-detail-sample-list">
            {ideas.map((idea, i) => (
              <li key={i}>
                <span className="bp-detail-sample-name">{idea.name}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {quests.length > 0 && (
        <section className="bp-detail-sample-block">
          <h3 className="bp-detail-sample-title">Quests waiting</h3>
          <ul className="bp-detail-sample-list">
            {quests.map((q, i) => (
              <li key={i}>
                <span className="bp-detail-sample-name">{q.subject}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
