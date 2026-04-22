import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import AgentAvatar from "./AgentAvatar";
import { Button, EmptyState, Panel } from "./ui";
import type { Agent } from "@/lib/types";

const NO_AGENTS: Agent[] = [];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "still up";
  if (h < 12) return "good morning";
  if (h < 17) return "good afternoon";
  if (h < 22) return "good evening";
  return "welcome back";
}

function firstName(name: string | undefined, email: string | undefined): string | null {
  const raw = name || email?.split("@")[0] || "";
  if (!raw) return null;
  const seg = raw.split(/[\s._-]+/)[0];
  if (!seg) return null;
  return seg.charAt(0).toUpperCase() + seg.slice(1);
}

/**
 * Home — root `/` landing. MVP: one decisive primary action (launch an
 * autonomous company) sits above the fold; the list of existing companies
 * below is a browse surface, not a dashboard. Stats / activity / quests
 * live on their per-agent surfaces, not here.
 */
export default function HomeDashboard() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const agents = useDaemonStore((s) => s.agents) || NO_AGENTS;

  useEffect(() => {
    document.title = "home · æqi";
  }, []);

  const name = firstName(user?.name, user?.email);
  const greet = greeting();
  const heading = name ? `${greet}, ${name}` : greet;

  const companies = useMemo(() => agents.filter((a) => !a.parent_id), [agents]);
  const agentCountsByRoot = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of agents) {
      if (a.parent_id) counts.set(a.parent_id, (counts.get(a.parent_id) ?? 0) + 1);
    }
    return counts;
  }, [agents]);

  const openCompany = (id: string) => navigate(`/${encodeURIComponent(id)}`);

  const ctaLabel =
    companies.length === 0 ? "Launch your first autonomous company" : "Launch autonomous company";

  return (
    <div className="home">
      <h1 className="home-greeting">{heading}</h1>

      <Button
        variant="primary"
        size="lg"
        fullWidth
        className="home-cta"
        onClick={() => navigate("/new")}
      >
        <span className="home-cta-label">{ctaLabel}</span>
        <span className="home-cta-arrow" aria-hidden>
          →
        </span>
      </Button>

      <Panel
        title="Autonomous companies"
        actions={<span className="home-panel-count">{companies.length}</span>}
      >
        {companies.length === 0 ? (
          <EmptyState
            eyebrow="Nothing spun up"
            title="No companies yet"
            description="Spin one up with the button above."
          />
        ) : (
          <ul className="home-companies" role="list">
            {companies.map((c) => {
              const label = c.display_name || c.name;
              const childCount = agentCountsByRoot.get(c.id) ?? 0;
              return (
                <li key={c.id}>
                  <button type="button" className="home-company" onClick={() => openCompany(c.id)}>
                    <AgentAvatar name={label} />
                    <span className="home-company-name">{label}</span>
                    <span className="home-company-meta">
                      {childCount} {childCount === 1 ? "agent" : "agents"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
