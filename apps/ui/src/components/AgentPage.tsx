import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useCompanyNav } from "@/hooks/useCompanyNav";
import { useDaemonStore } from "@/store/daemon";
import { api } from "@/lib/api";
import PageTabs from "./PageTabs";
import AgentSessionView from "./AgentSessionView";
import AgentEventsTab from "./AgentEventsTab";
import RoundAvatar from "./RoundAvatar";
import { EmptyState } from "./ui/EmptyState";
import type { Idea } from "@/lib/types";

const TABS = [
  { id: "sessions", label: "Sessions" },
  { id: "agents", label: "Agents" },
  { id: "quests", label: "Quests" },
  { id: "ideas", label: "Ideas" },
  { id: "events", label: "Events" },
  { id: "tools", label: "Tools" },
];

const ALL_TOOLS = [
  "shell",
  "read_file",
  "write_file",
  "edit_file",
  "grep",
  "glob",
  "ideas",
  "quests",
  "agents",
  "events",
  "code",
  "web_search",
  "web_fetch",
];

function formatTokens(n?: number): string {
  if (n == null || n === 0) return "0";
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export default function AgentPage({ agentId }: { agentId: string }) {
  const { go } = useCompanyNav();
  const { tab: routeTab, itemId } = useParams<{
    tab?: string;
    itemId?: string;
  }>();
  const activeTab = routeTab && TABS.some((t) => t.id === routeTab) ? routeTab : "sessions";
  const sessionId = activeTab === "sessions" ? itemId || null : null;

  const agents = useDaemonStore((s) => s.agents);
  const quests = useDaemonStore((s) => s.quests);
  const agent = agents.find((a) => a.id === agentId || a.name === agentId);
  const displayName = agent?.display_name || agent?.name || agentId;

  const resolvedAgentId = agent?.id || agentId;

  // Child agents for the "agents" tab
  const childAgents = agents.filter((a) => a.parent_id === agent?.id);

  // Quests scoped to this agent
  const agentQuests = quests.filter((q) => (q as Record<string, unknown>).agent_id === agent?.id);

  // Ideas scoped to this agent
  const [agentIdeas, setAgentIdeas] = useState<Idea[]>([]);
  useEffect(() => {
    if (activeTab !== "ideas" || !agent?.idea_ids?.length) {
      setAgentIdeas([]);
      return;
    }
    api
      .getIdeasByIds(agent.idea_ids)
      .then((res) => setAgentIdeas(res.ideas || []))
      .catch(() => setAgentIdeas([]));
  }, [activeTab, agent?.idea_ids]);

  // Save feedback toast
  const [toast, setToast] = useState<{ message: string; isError: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(null);

  const showToast = useCallback((message: string, isError = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, isError });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  return (
    <>
      {/* Breadcrumb header */}
      <div className="content-topbar">
        <div className="content-topbar-left">
          <span className="content-topbar-breadcrumb" onClick={() => go(`/agents`)}>
            Agents
          </span>
          <span className="content-topbar-sep">/</span>
          <RoundAvatar name={agent?.name || agentId} size={18} />
          <span className="content-topbar-title">{displayName}</span>
          {agent?.status && (
            <span className={`content-topbar-status ${agent.status === "active" ? "live" : ""}`} />
          )}
        </div>
        <div className="content-topbar-right">
          <span className="content-topbar-meta">{agent?.model?.split("/").pop()}</span>
          <span className="content-topbar-meta">{formatTokens(agent?.total_tokens)} tokens</span>
          {agent?.budget_usd != null && (
            <span className="content-topbar-meta">${agent.budget_usd.toFixed(2)}</span>
          )}
          <button className="content-topbar-btn" title="Settings">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Page tabs */}
      <PageTabs tabs={TABS} defaultTab="sessions" />

      {/* Save feedback toast */}
      {toast && (
        <div
          style={{
            padding: "8px 16px",
            margin: "8px 16px 0",
            borderRadius: 6,
            fontSize: 13,
            background: toast.isError ? "var(--error, #dc2626)" : "var(--success, #16a34a)",
            color: "#fff",
          }}
        >
          {toast.message}
        </div>
      )}

      {/* Tab content */}
      {activeTab === "sessions" && (
        <div className="agent-page-chat">
          <AgentSessionView agentId={agentId} sessionId={sessionId} />
        </div>
      )}

      {activeTab === "agents" && (
        <div className="page-content" style={{ padding: "16px" }}>
          {childAgents.length > 0 ? (
            <div className="agent-children-grid">
              {childAgents.map((child) => (
                <div
                  key={child.id}
                  className="agent-child-card"
                  onClick={() => go(`/agents/${child.id}`)}
                >
                  <RoundAvatar name={child.name} size={28} />
                  <div>
                    <div className="agent-child-name">{child.display_name || child.name}</div>
                    <div className="agent-child-status">{child.status}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No child agents"
              description="This agent hasn't spawned any sub-agents."
            />
          )}
        </div>
      )}

      {activeTab === "quests" && (
        <div className="page-content" style={{ padding: "16px" }}>
          {agentQuests.length > 0 ? (
            agentQuests.map((quest) => {
              const q = quest as Record<string, unknown>;
              return (
                <div key={q.id as string} className="scoped-quest-row">
                  <span className="scoped-quest-status">{q.status as string}</span>
                  <span className="scoped-quest-subject">{q.subject as string}</span>
                </div>
              );
            })
          ) : (
            <EmptyState title="No quests" description="No work items assigned to this agent." />
          )}
        </div>
      )}

      {activeTab === "ideas" && (
        <div className="page-content" style={{ padding: "16px" }}>
          {agentIdeas.length > 0 ? (
            agentIdeas.map((idea) => (
              <div key={idea.id} className="scoped-quest-row">
                <span className="scoped-quest-status">{idea.tags?.join(", ") || "idea"}</span>
                <span className="scoped-quest-subject">{idea.name}</span>
              </div>
            ))
          ) : (
            <EmptyState title="No ideas" description="No ideas attached to this agent." />
          )}
        </div>
      )}

      {activeTab === "events" && (
        <div className="agent-page-chat">
          <AgentEventsTab agentId={resolvedAgentId} />
        </div>
      )}

      {activeTab === "tools" && (
        <div className="page-content" style={{ padding: "16px" }}>
          <div className="tools-grid">
            {ALL_TOOLS.map((tool) => {
              const allowed = !agent?.tool_deny?.includes(tool);
              return (
                <button
                  key={tool}
                  className={`tool-card ${allowed ? "tool-active" : ""}`}
                  onClick={async () => {
                    const current = agent?.tool_deny || [];
                    const next = allowed ? [...current, tool] : current.filter((t) => t !== tool);
                    try {
                      await api.setAgentTools(resolvedAgentId, next);
                      showToast("Tools saved");
                    } catch (err) {
                      showToast(
                        `Error: ${err instanceof Error ? err.message : "Failed to save tools"}`,
                        true,
                      );
                    }
                  }}
                >
                  <span className="tool-name">{tool}</span>
                  <span className="tool-status">{allowed ? "active" : "off"}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
