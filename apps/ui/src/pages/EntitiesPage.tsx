import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useUIStore } from "@/store/ui";
import { useDaemonStore } from "@/store/daemon";
import BlockAvatar from "@/components/BlockAvatar";
import type { Agent } from "@/lib/types";

interface Entity {
  name: string;
  tagline?: string;
  tier?: string;
  agentCount?: number;
}

interface CompanyApiItem {
  name?: string;
  company?: string;
  tagline?: string;
  tier?: string;
  agent_count?: number;
}

function deriveEntitiesFromAgents(agents: Agent[]): Entity[] {
  const roots = agents.filter((a) => !a.parent_id && a.project);
  const projectNames = [...new Set(roots.map((a) => a.project!).filter(Boolean))];
  return projectNames.map((name) => ({
    name,
    agentCount: agents.filter((a) => a.project === name).length,
  }));
}

export default function EntitiesPage() {
  const activeCompany = useUIStore((s) => s.activeCompany);
  const setActiveCompany = useUIStore((s) => s.setActiveCompany);
  const agents = useDaemonStore((s) => s.agents);
  const navigate = useNavigate();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .getCompanies()
      .then((data) => {
        const raw = data?.companies || data?.projects || data?.agent_spawns || [];
        const items: CompanyApiItem[] = Array.isArray(raw) ? raw : [];
        if (items.length > 0) {
          setEntities(
            items
              .map((c) => ({
                name: c.name || c.company || "",
                tagline: c.tagline,
                tier: c.tier || "Free",
                agentCount: c.agent_count,
              }))
              .filter((e) => e.name),
          );
        } else {
          setEntities(deriveEntitiesFromAgents(agents));
        }
      })
      .catch(() => {
        setEntities(deriveEntitiesFromAgents(agents));
        setError("Could not load entities from server. Showing local data.");
      })
      .finally(() => setLoading(false));
  }, [agents]);

  const selectEntity = (name: string) => {
    setActiveCompany(name);
    navigate("/");
  };

  return (
    <div style={{ padding: 24, maxWidth: 560 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <h2 style={{ color: "var(--text-primary)", fontSize: 16, fontWeight: 600, margin: 0 }}>
          Your entities
        </h2>
        <button
          onClick={() => navigate("/new")}
          style={{
            background: "var(--accent)",
            color: "#fff",
            border: "none",
            borderRadius: "var(--radius-md)",
            padding: "6px 14px",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          New entity
        </button>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            fontSize: 12,
            color: "var(--warning)",
            padding: "8px 12px",
            background: "rgba(245, 158, 11, 0.06)",
            borderRadius: "var(--radius-md)",
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "40px 0", textAlign: "center" }}>
          Loading entities...
        </div>
      ) : entities.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "40px 0", textAlign: "center" }}>
          No entities yet. Create your first company to get started.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {entities.map((entity) => (
            <button
              key={entity.name}
              onClick={() => selectEntity(entity.name)}
              aria-pressed={entity.name === activeCompany}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                background: entity.name === activeCompany ? "var(--bg-elevated)" : "transparent",
                border: "none",
                borderRadius: "var(--radius-sm)",
                cursor: "pointer",
                width: "100%",
                textAlign: "left",
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => {
                if (entity.name !== activeCompany) e.currentTarget.style.background = "var(--bg-surface)";
              }}
              onMouseLeave={(e) => {
                if (entity.name !== activeCompany) e.currentTarget.style.background = "transparent";
              }}
            >
              <BlockAvatar name={entity.name} size={32} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {entity.name}
                </div>
                {entity.tagline && (
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {entity.tagline}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                {entity.tier && (
                  <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>
                    {entity.tier}
                  </span>
                )}
                {entity.name === activeCompany && (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: "var(--text-secondary)" }} aria-label="Selected">
                    <path d="M3 7l3 3 5-5.5" />
                  </svg>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
