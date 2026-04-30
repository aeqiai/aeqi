import type { CompanyTemplate } from "@/lib/types";

interface BlueprintTreePreviewProps {
  template: CompanyTemplate;
}

/**
 * Org-chart preview for a Blueprint. Renders as a layered DAG matching
 * the post-spawn shape (`EntityRolesTab`'s chart view) — what the user
 * picks IS what they get.
 *
 * Each card is a ROLE: the title is the structural unit ("CTO",
 * "Engineer"), and the occupant line below names the default agent
 * filling it. When the user provisions, they can swap any occupant
 * for themselves (human) or leave it vacant.
 *
 * v1 reads `seed_agents[].role` (title) and `seed_agents[].name`
 * (default occupant). When the JSON shape gains explicit `seed_roles`
 * + `seed_role_edges` (WS-2), this component will render the declared
 * DAG instead of the implicit root → flat-children layout.
 */
export function BlueprintTreePreview({ template }: BlueprintTreePreviewProps) {
  const seeds = template.seed_agents ?? [];
  const rootName = template.root?.name ?? template.name;
  const rootColor = template.root?.color;
  return (
    <div className="bp-orgchart" aria-hidden="true">
      <div className="bp-orgchart-row bp-orgchart-row--root">
        <div
          className="bp-role-card bp-role-card--root"
          style={rootColor ? { borderColor: rootColor } : undefined}
        >
          <span className="bp-role-title">{rootName}</span>
          <span className="bp-role-occupant">root agent</span>
        </div>
      </div>
      {seeds.length > 0 && (
        <>
          <svg className="bp-orgchart-edges" viewBox="0 0 100 24" preserveAspectRatio="none">
            {seeds.map((_, i) => {
              const total = seeds.length;
              const x = total === 1 ? 50 : 12 + (i * 76) / Math.max(1, total - 1);
              return (
                <path
                  key={i}
                  d={`M50 0 C50 12 ${x} 12 ${x} 24`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="0.5"
                  strokeOpacity="0.35"
                />
              );
            })}
          </svg>
          <div className="bp-orgchart-row">
            {seeds.map((seed, i) => {
              const tip = seed.system_prompt || seed.tagline || seed.role || seed.name;
              const roleTitle = seed.role || seed.name;
              const occupant = seed.role ? seed.name : "agent";
              return (
                <div
                  key={`${seed.name}-${i}`}
                  className="bp-role-card"
                  style={{
                    animationDelay: `${100 + i * 70}ms`,
                    ...(seed.color ? { borderColor: seed.color } : {}),
                  }}
                  title={tip}
                >
                  <span className="bp-role-title">{roleTitle}</span>
                  <span className="bp-role-occupant">
                    {seed.color && (
                      <span
                        className="bp-role-occupant-dot"
                        style={{ background: seed.color }}
                        aria-hidden="true"
                      />
                    )}
                    {occupant}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
