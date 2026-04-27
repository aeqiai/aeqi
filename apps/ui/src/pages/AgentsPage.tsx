import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useUIStore } from "@/store/ui";
import { useDaemonStore } from "@/store/daemon";
import BlockAvatar from "@/components/BlockAvatar";
import { Button, EmptyState, Spinner } from "@/components/ui";
import type { Agent } from "@/lib/types";

interface Entity {
  id: string;
  name: string;
  tagline?: string;
  tier?: string;
  agentCount?: number;
}

interface RootApiItem {
  id?: string;
  name?: string;
  root?: string;
  tagline?: string;
  tier?: string;
  agent_count?: number;
}

function deriveEntitiesFromAgents(agents: Agent[]): Entity[] {
  const roots = agents.filter((a) => !a.parent_id);
  return roots.map((a) => ({
    id: a.id,
    name: a.name,
    agentCount: agents.filter((child) => child.name === a.name).length,
  }));
}

export default function AgentsPage() {
  const activeEntity = useUIStore((s) => s.activeEntity);
  const setActiveEntity = useUIStore((s) => s.setActiveEntity);
  const agents = useDaemonStore((s) => s.agents);
  const navigate = useNavigate();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "agents · æqi";
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);

    api
      .getEntities()
      .then((data) => {
        const raw = data?.roots || data?.projects || data?.agent_spawns || [];
        const items: RootApiItem[] = Array.isArray(raw) ? raw : [];
        if (items.length > 0) {
          setEntities(
            items
              .map((c) => ({
                id: c.id || c.name || c.root || "",
                name: c.name || c.root || "",
                tagline: c.tagline,
                tier: c.tier || "Free",
                agentCount: c.agent_count,
              }))
              .filter((e) => e.id),
          );
        } else {
          return api.getAgents({ root: true }).then((agentData) => {
            const agentList = (agentData?.agents || []) as Array<Record<string, unknown>>;
            const roots = agentList.filter((a) => !a.parent_id);
            if (roots.length > 0) {
              setEntities(
                roots.map((a) => ({
                  id: (a.id as string) || "",
                  name: (a.name as string) || "",
                  agentCount: agentList.filter((c) => c.parent_id === a.id).length,
                })),
              );
            } else {
              setEntities(deriveEntitiesFromAgents(agents));
            }
          });
        }
      })
      .catch(() => {
        setEntities(deriveEntitiesFromAgents(agents));
        setError("Could not load agents. Showing local data.");
      })
      .finally(() => setLoading(false));
  }, [agents]);

  useEffect(() => {
    const handler = () => navigate("/new");
    window.addEventListener("aeqi:create", handler);
    return () => window.removeEventListener("aeqi:create", handler);
  }, [navigate]);

  const selectEntity = (entity: Entity) => {
    setActiveEntity(entity.id);
    navigate(`/${encodeURIComponent(entity.id)}`);
  };

  return (
    <div className="entities">
      <header className="entities-header">
        <h2 className="entities-title">Agents</h2>
        <Button variant="primary" size="sm" onClick={() => navigate("/new")}>
          New agent
        </Button>
      </header>

      {error && (
        <div className="entities-alert" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="entities-loading" role="status">
          <Spinner size="sm" />
          Loading agents…
        </div>
      ) : entities.length === 0 ? (
        <EmptyState
          title="No agents yet"
          description="Spin up your first agent — pick a template or start from scratch."
          action={
            <Button variant="primary" onClick={() => navigate("/new")}>
              New agent
            </Button>
          }
        />
      ) : (
        <ul className="entities-list" role="list">
          {entities.map((entity) => {
            const label = entity.name;
            const selected = entity.id === activeEntity;
            return (
              <li key={entity.id}>
                <button
                  type="button"
                  className="entity-row"
                  aria-pressed={selected}
                  onClick={() => selectEntity(entity)}
                >
                  <BlockAvatar name={label} size={32} />
                  <div className="entity-body">
                    <div className="entity-name">{label}</div>
                    {entity.tagline && <div className="entity-tagline">{entity.tagline}</div>}
                  </div>
                  <div className="entity-meta">
                    {entity.tier && <span className="entity-tier">{entity.tier}</span>}
                    {selected && (
                      <svg
                        className="entity-check"
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        aria-label="Selected"
                      >
                        <path d="M3 7l3 3 5-5.5" />
                      </svg>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
