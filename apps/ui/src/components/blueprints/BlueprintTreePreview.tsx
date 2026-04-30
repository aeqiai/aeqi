import type { Blueprint, BlueprintSeedAgent, BlueprintSeedRole } from "@/lib/types";

interface BlueprintTreePreviewProps {
  template: Blueprint;
}

/**
 * Org-chart preview for a Blueprint. Renders as a layered DAG matching
 * the post-spawn shape (`EntityRolesTab`'s chart view) — what the user
 * picks IS what they get.
 *
 * Each card is a ROLE (the structural slot); the occupant line names
 * the default agent that fills it (or "vacant"). When the operator
 * provisions, they'll be able to swap any occupant for themselves
 * (human) or leave it vacant — that picker is the next phase.
 *
 * Reads declared `seed_roles` + `seed_role_edges` when present; falls
 * back to the implicit root → flat seed_agents shape otherwise.
 * Declared roles must mirror the agent tree 1:1 today (the
 * orchestrator still auto-derives positions from seed_agents at spawn);
 * the JSON shape is in place for the spawn refactor.
 */
export function BlueprintTreePreview({ template }: BlueprintTreePreviewProps) {
  const rootName = template.root?.name ?? template.name;
  const rootColor = template.root?.color;
  const declared = (template.seed_roles ?? []).length > 0;

  if (declared) {
    return (
      <DeclaredRoleChart
        template={template}
        rootName={rootName}
        rootColor={rootColor ?? undefined}
      />
    );
  }
  return (
    <ImplicitFlatChart
      seeds={template.seed_agents ?? []}
      rootName={rootName}
      rootColor={rootColor ?? undefined}
    />
  );
}

/** Declared layout: layered DAG over `seed_roles` + `seed_role_edges`,
 *  with the root role on top (the entity's own role) and edges driving
 *  layer assignment. */
function DeclaredRoleChart({
  template,
  rootName,
  rootColor,
}: {
  template: Blueprint;
  rootName: string;
  rootColor?: string;
}) {
  const roles = template.seed_roles ?? [];
  const edges = template.seed_role_edges ?? [];
  const seedAgents = template.seed_agents ?? [];
  const agentByName = new Map<string, BlueprintSeedAgent>();
  for (const a of seedAgents) agentByName.set(a.name, a);

  // Compute longest-path depth from any root (a role with no incoming
  // edges). Same algorithm as EntityRolesTab's chart view.
  const incoming = new Map<string, string[]>();
  for (const r of roles) incoming.set(r.key, []);
  for (const e of edges) {
    if (!incoming.has(e.child)) continue;
    incoming.get(e.child)!.push(e.parent);
  }
  const depth = new Map<string, number>();
  const visit = (id: string, seen: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const parents = incoming.get(id) ?? [];
    if (parents.length === 0) {
      depth.set(id, 0);
      return 0;
    }
    let d = 0;
    for (const p of parents) d = Math.max(d, visit(p, seen) + 1);
    depth.set(id, d);
    return d;
  };
  for (const r of roles) visit(r.key, new Set());
  const maxDepth = Math.max(0, ...Array.from(depth.values()));
  const layers: BlueprintSeedRole[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const r of roles) layers[depth.get(r.key) ?? 0].push(r);

  return (
    <div className="bp-orgchart" aria-hidden="true">
      {layers.map((layer, layerIdx) => (
        <div key={layerIdx} className="bp-orgchart-row">
          {layer.map((role, i) => {
            const isRoot =
              role.default_occupant_agent === "root" || role.default_occupant_agent === rootName;
            const occupantName = role.default_occupant_agent ?? null;
            const occupantAgent = occupantName ? agentByName.get(occupantName) : undefined;
            const swatchColor = isRoot ? rootColor : (occupantAgent?.color ?? undefined);
            const subtitle = occupantName ? (isRoot ? rootName : occupantName) : "vacant";
            return (
              <div
                key={role.key}
                className={`bp-role-card${isRoot ? " bp-role-card--root" : ""}`}
                style={{
                  animationDelay: `${50 + (layerIdx * 80 + i * 50)}ms`,
                  ...(swatchColor && !isRoot ? { borderColor: swatchColor } : {}),
                  ...(isRoot && rootColor ? { borderColor: rootColor } : {}),
                }}
                title={occupantAgent?.system_prompt || occupantAgent?.tagline || role.title}
              >
                <span className="bp-role-title">{role.title}</span>
                <span className="bp-role-occupant">
                  {swatchColor && !isRoot && (
                    <span
                      className="bp-role-occupant-dot"
                      style={{ background: swatchColor }}
                      aria-hidden="true"
                    />
                  )}
                  {subtitle}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Implicit fallback: every seed_agent renders as a direct child of
 *  the root. Used by blueprints that haven't declared seed_roles yet. */
function ImplicitFlatChart({
  seeds,
  rootName,
  rootColor,
}: {
  seeds: BlueprintSeedAgent[];
  rootName: string;
  rootColor?: string;
}) {
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
