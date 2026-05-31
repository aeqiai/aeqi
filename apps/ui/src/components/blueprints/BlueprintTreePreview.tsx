import type { SingleBlueprint, BlueprintSeedAgent } from "@/lib/types";
import {
  describeBlueprintStructures,
  type BlueprintStructurePreview,
} from "@/lib/blueprintStructures";

interface BlueprintTreePreviewProps {
  template: SingleBlueprint;
}

/**
 * Org-chart preview for a Blueprint. Renders as a layered DAG that
 * mirrors the post-spawn shape (`CompanyRolesTab`'s chart view) — what
 * the user picks IS what they get. Wrapped in a bordered card with a
 * header so it reads as an intentional product surface, not a sketch.
 *
 * Each card is a ROLE (the structural slot); the occupant line names
 * the default agent that fills it (or "vacant"). Roles are tagged by
 * category (leadership / engineering / ops-support) via a title-keyword
 * heuristic so the user can scan the team's makeup at a glance — the
 * three buckets get distinct visual weights without inventing new
 * tokens (border tone + category eyebrow chip).
 *
 * Reads declared `seed_roles` + `seed_role_edges` when present; falls
 * back to a default role plus flat seed_agents otherwise.
 */
export function BlueprintTreePreview({ template }: BlueprintTreePreviewProps) {
  const structures = describeBlueprintStructures(template);
  const multi = structures.length > 1;
  const rootName = template.root?.name ?? template.name;
  const rootColor = template.root?.color ?? undefined;
  const agentByName = new Map<string, BlueprintSeedAgent>();
  for (const agent of template.seed_agents ?? []) {
    agentByName.set(agent.name, agent);
  }

  return (
    <section className="bp-orgchart-card" aria-label="Org chart">
      <header className="bp-orgchart-card-head">
        <h2 className="bp-orgchart-card-title">Org chart</h2>
        <p className="bp-orgchart-card-sub">
          {multi
            ? `${structures.length} structures · previewed as separate role trees.`
            : "Roles ship pre-filled with default agents."}
        </p>
      </header>
      <div className="bp-orgchart" aria-hidden="true">
        {structures.map((structure, idx) => (
          <StructureBlock
            key={structure.id}
            structure={structure}
            index={idx}
            multi={multi}
            rootName={rootName}
            rootColor={rootColor}
            agentByName={agentByName}
          />
        ))}
      </div>
    </section>
  );
}

function isDefaultAgentRef(value: string | null | undefined, defaultAgentName: string): boolean {
  return !value || value === "default" || value === "root" || value === defaultAgentName;
}

function displayOccupant(
  value: string | null | undefined,
  defaultAgentName: string,
): string | null {
  if (!value) return null;
  return isDefaultAgentRef(value, defaultAgentName) ? defaultAgentName : value;
}

function StructureBlock({
  structure,
  index,
  multi,
  rootName,
  rootColor,
  agentByName,
}: {
  structure: BlueprintStructurePreview;
  index: number;
  multi: boolean;
  rootName: string;
  rootColor?: string;
  agentByName: Map<string, BlueprintSeedAgent>;
}) {
  return (
    <section className={`bp-structure-block${multi ? " bp-structure-block--multi" : ""}`}>
      {multi && (
        <header className="bp-structure-head">
          <span className="bp-structure-eyebrow">Structure {index + 1}</span>
          <span className="bp-structure-title">{structure.title}</span>
          <span className="bp-structure-sub">{structure.subtitle}</span>
        </header>
      )}
      {structure.layers.map((layer, layerIdx) => {
        const showConnector = layerIdx > 0 && layer.length > 0;
        return (
          <div key={`${structure.id}-${layerIdx}`} className="bp-orgchart-layer">
            {showConnector && <ConnectorRow count={layer.length} />}
            <div className="bp-orgchart-row">
              {layer.map((role, i) => {
                const isRoot =
                  structure.rootKeys.includes(role.key) ||
                  isDefaultAgentRef(role.default_occupant_agent, rootName);
                const occupantName = displayOccupant(role.default_occupant_agent, rootName);
                const occupantAgent = occupantName ? agentByName.get(occupantName) : undefined;
                const subtitle = occupantName ? occupantName : "vacant";
                const category = isRoot ? "leadership" : categorizeRole(role.title);
                const swatchColor = isRoot ? rootColor : (occupantAgent?.color ?? undefined);
                return (
                  <article
                    key={role.key}
                    className={`bp-role-card bp-role-card--${category}${
                      isRoot ? " bp-role-card--root" : ""
                    }`}
                    style={{
                      animationDelay: `${50 + (layerIdx * 80 + i * 50)}ms`,
                    }}
                    title={occupantAgent?.system_prompt || occupantAgent?.tagline || role.title}
                  >
                    <span className="bp-role-eyebrow">{categoryLabel(category)}</span>
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
                  </article>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}

/** SVG bus connecting one layer's parent area down to N children below.
 *  Centered T-shape: vertical drop from the row above, horizontal
 *  spine across the children's centerline, vertical risers up to each
 *  child. Cheap, layout-agnostic — children sit on a flex row with
 *  even justify-content: space-evenly, so the percentages line up. */
function ConnectorRow({ count }: { count: number }) {
  if (count === 0) return null;
  const positions: number[] = Array.from({ length: count }, (_, i) =>
    count === 1 ? 50 : 8 + (i * 84) / (count - 1),
  );
  const left = positions[0];
  const right = positions[positions.length - 1];
  return (
    <svg
      className="bp-orgchart-connector"
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      aria-hidden
    >
      {/* Vertical drop from above into the spine */}
      <line x1="50" y1="0" x2="50" y2="12" />
      {/* Horizontal spine */}
      <line x1={left} y1="12" x2={right} y2="12" />
      {/* Risers down to each child */}
      {positions.map((x, i) => (
        <line key={i} x1={x} y1="12" x2={x} y2="24" />
      ))}
    </svg>
  );
}

/* ── Category heuristic ──────────────────────────────── */

type RoleCategory = "leadership" | "engineering" | "ops";

const LEADERSHIP_KEYWORDS = [
  "founder",
  "ceo",
  "cto",
  "cfo",
  "coo",
  "chief",
  "head",
  "lead",
  "director",
  "principal",
  "owner",
  "partner",
  "manager",
  "managing",
];

const ENGINEERING_KEYWORDS = ["engineer", "developer", "architect", "dev"];

function categorizeRole(title: string): RoleCategory {
  const t = title.toLowerCase();
  // Engineering matches first — "Designer-Engineer" should hit engineering,
  // not get caught by a "designer" → ops match later if it grows.
  for (const k of ENGINEERING_KEYWORDS) {
    if (t.includes(k)) return "engineering";
  }
  for (const k of LEADERSHIP_KEYWORDS) {
    // word-boundary check so "Operator" doesn't match "lead" via "lEAD"er
    // (substring would match anyway, but anchoring keeps the rule narrow).
    if (new RegExp(`\\b${k}\\b`).test(t)) return "leadership";
  }
  return "ops";
}

function categoryLabel(c: RoleCategory): string {
  if (c === "leadership") return "lead";
  if (c === "engineering") return "eng";
  return "ops";
}
