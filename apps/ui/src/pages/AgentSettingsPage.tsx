import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useNav } from "@/hooks/useNav";
import { useDaemonStore } from "@/store/daemon";
import { api } from "@/lib/api";
import { entityPathFromId } from "@/lib/entityPath";
import { formatMediumDate } from "@/lib/i18n";
import { Button } from "@/components/ui";
import ModelPicker from "@/components/ModelPicker";
import { ALL_TOOLS, TOOL_BY_ID } from "@/lib/tools";
import AgentSurfaceHeader from "@/components/AgentSurfaceHeader";
import { AGENT_RAIL_TABS } from "@/components/agentRailTabs";

const AgentEventsTab = lazy(() => import("@/components/AgentEventsTab"));
const AgentChannelsTab = lazy(() => import("@/components/AgentChannelsTab"));
const AgentIdeasTab = lazy(() => import("@/components/AgentIdeasTab"));
const AgentQuestsTab = lazy(() => import("@/components/AgentQuestsTab"));
const AgentOverviewTab = lazy(() => import("@/components/AgentOverviewTab"));
const AgentIntegrationsTab = lazy(() => import("@/pages/Agent/Integrations"));

/**
 * `/trust/<addr>/agents/<agent>/settings[/<sub>[/<itemId>]]` — the
 * settings sub-surface for a drilled agent.
 *
 * Header: breadcrumb [← <Agent>] / <Agent> / Settings
 * Body: PageRail (Overview · Quests · Events · Ideas · Channels ·
 *       Tools · Integrations) + the active
 *       sub-tab's content. Default sub-tab = Overview. Settings is
 *       NOT a tab inside the rail — it's the rail's container; the
 *       sub-tabs are the canonical "settings for this agent" pages.
 *
 * The header lives at the top of the right pane (below the
 * page-internal rail in narrow layouts; alongside it at desktop
 * widths). The rail itself is mounted by AppLayout at the
 * .content-body-row level so it sits as a sibling of the chat
 * surface's sessions rail when present (settings has no chat though).
 */

const SUB_TABS = new Set(AGENT_RAIL_TABS.map((t) => t.id));

export default function AgentSettingsPage({ agentId }: { agentId: string }) {
  const params = useParams<{ settingsTab?: string; itemId?: string }>();
  const settingsTab = params.settingsTab;
  const itemId = params.itemId ?? null;
  const activeTab = settingsTab && SUB_TABS.has(settingsTab) ? settingsTab : "overview";

  const agents = useDaemonStore((s) => s.agents);
  const agent = agents.find((a) => a.id === agentId);
  const resolvedAgentId = agent?.id || agentId;
  const resolvedEntityId = agent?.trust_id || resolvedAgentId;
  const isDrilledAgent = resolvedAgentId !== resolvedEntityId;

  const [toast, setToast] = useState<{ message: string; isError: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const showToast = useCallback((message: string, isError = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, isError });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <AgentSurfaceHeader agentId={resolvedAgentId} variant="settings" />

      {toast && (
        <div
          style={{
            padding: "8px 16px",
            margin: "8px 16px 0",
            borderRadius: 6,
            fontSize: 13,
            background: toast.isError ? "var(--color-error)" : "var(--color-success)",
            color: "var(--btn-primary-text)",
          }}
        >
          {toast.message}
        </div>
      )}

      <Suspense>
        {activeTab === "overview" && isDrilledAgent && (
          <AgentOverviewTab agentId={resolvedAgentId} trustId={resolvedEntityId} />
        )}
        {activeTab === "quests" && <AgentQuestsTab agentId={resolvedAgentId} />}
        {activeTab === "events" && <AgentEventsTab agentId={resolvedAgentId} />}
        {activeTab === "ideas" && <AgentIdeasTab agentId={resolvedAgentId} />}
        {activeTab === "channels" && <AgentChannelsTab agentId={resolvedAgentId} />}
        {activeTab === "tools" && (
          <ToolsDetail
            agent={agent}
            resolvedAgentId={resolvedAgentId}
            itemId={itemId}
            showToast={showToast}
          />
        )}
        {activeTab === "integrations" && <AgentIntegrationsTab agentId={resolvedAgentId} />}

        {/* Configuration tabs — model picker, danger zone — live on the
            Overview sub-tab as the canonical "agent settings" page.
            Operational tabs (Quests/Events/Ideas/Channels) take
            precedence; the legacy "settings" content is at the bottom
            of Overview. */}
        {activeTab === "overview" && (
          <SettingsPanel
            agent={agent}
            agentId={agentId}
            resolvedAgentId={resolvedAgentId}
            showToast={showToast}
          />
        )}
      </Suspense>
    </div>
  );
}

/**
 * Tools tab content — list/detail. No selection → inline picker;
 * selection → detail with toggle. Item id comes from the route's
 * third segment (`/settings/tools/<id>`).
 */
function ToolsDetail({
  agent,
  resolvedAgentId,
  itemId,
  showToast,
}: {
  agent: ReturnType<typeof useDaemonStore.getState>["agents"][0] | undefined;
  resolvedAgentId: string;
  itemId: string | null;
  showToast: (msg: string, isError?: boolean) => void;
}) {
  const navigate = useNavigate();
  const { base } = useNav();
  const selected = itemId ? TOOL_BY_ID[itemId] : null;

  if (!selected) {
    const denied = agent?.tool_deny || [];
    const activeCount = ALL_TOOLS.length - denied.length;
    const agentTools = ALL_TOOLS.filter((t) => t.category === "aeqi");
    const globalTools = ALL_TOOLS.filter((t) => t.category !== "aeqi");
    const groups: Array<{ label: string; tools: typeof ALL_TOOLS }> = [
      { label: "agent tools", tools: agentTools },
      { label: "global tools", tools: globalTools },
    ];
    const openTool = (id: string) =>
      navigate(`${base}/agents/${encodeURIComponent(resolvedAgentId)}/settings/tools/${id}`);
    return (
      <div className="asv-main tools-list" style={{ overflowY: "auto" }}>
        <div className="tools-list-summary">
          <span className="tools-list-summary-n">
            {activeCount}/{ALL_TOOLS.length}
          </span>
          <span className="tools-list-summary-label">tools enabled</span>
        </div>
        {groups.map((g) => (
          <section key={g.label} className="tools-list-group-wrap">
            <div className="inline-picker-group">
              <span className="inline-picker-group-label">{g.label}</span>
              <span className="inline-picker-group-rule" />
              <span className="inline-picker-group-count">{g.tools.length}</span>
            </div>
            {g.tools.map((t) => {
              const allowed = !denied.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`tools-list-row${allowed ? "" : " is-off"}`}
                  onClick={() => openTool(t.id)}
                >
                  <span className="tools-list-row-cat">{t.category}</span>
                  <span className="tools-list-row-name">{t.label}</span>
                  <span className="tools-list-row-state">{allowed ? "on" : "off"}</span>
                </button>
              );
            })}
          </section>
        ))}
      </div>
    );
  }

  const isAskDirector = selected.id === "question.ask";
  const allowed = isAskDirector
    ? !!agent?.can_ask_director
    : !agent?.tool_deny?.includes(selected.id);

  const toggle = async () => {
    try {
      if (isAskDirector) {
        await api.setCanAskDirector(resolvedAgentId, !allowed);
      } else {
        const current = agent?.tool_deny || [];
        const next = allowed ? [...current, selected.id] : current.filter((t) => t !== selected.id);
        await api.setAgentTools(resolvedAgentId, next);
      }
      showToast("Tools saved");
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Failed to save tools"}`, true);
    }
  };

  return (
    <div className="asv-main" style={{ padding: "20px 28px", overflowY: "auto" }}>
      <div className="events-detail-header">
        <div>
          <h3 className="events-detail-name">{selected.label}</h3>
          <span className="events-detail-pattern">
            {selected.category} · {selected.id}
          </span>
        </div>
        <Button variant={allowed ? "secondary" : "primary"} onClick={toggle}>
          {allowed ? "Disable" : "Enable"}
        </Button>
      </div>
      <p
        style={{
          fontSize: 13,
          color: "var(--color-text-secondary)",
          lineHeight: 1.6,
          marginTop: 8,
        }}
      >
        {selected.description}
      </p>
      <div style={{ marginTop: 16, fontSize: 12, color: "var(--color-text-muted)" }}>
        Status:{" "}
        <span
          className="agent-settings-status-dot"
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: allowed ? "var(--success)" : "var(--color-text-muted)",
            marginRight: 6,
            verticalAlign: "middle",
          }}
        />
        {allowed ? "enabled for this agent" : "blocked for this agent"}
      </div>
    </div>
  );
}

function SettingsPanel({
  agent,
  agentId,
  resolvedAgentId,
  showToast,
}: {
  agent: ReturnType<typeof useDaemonStore.getState>["agents"][0] | undefined;
  agentId: string;
  resolvedAgentId: string;
  showToast: (msg: string, isError?: boolean) => void;
}) {
  const agents = useDaemonStore((s) => s.agents);
  const fetchAgents = useDaemonStore((s) => s.fetchAgents);
  const childAgents = useMemo(() => {
    const self = agents.find((a) => a.id === resolvedAgentId);
    if (!self?.trust_id) return [];
    return agents.filter((a) => a.trust_id === self.trust_id && a.id !== resolvedAgentId);
  }, [agents, resolvedAgentId]);

  const [localModel, setLocalModel] = useState(agent?.model || "");
  useEffect(() => {
    setLocalModel(agent?.model || "");
  }, [agent?.model]);

  const [modelSave, setModelSave] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [modelError, setModelError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveModel = useCallback(
    async (slug: string) => {
      const trimmed = slug.trim();
      if (!trimmed || trimmed === agent?.model) return;
      setLocalModel(trimmed);
      setModelSave("saving");
      setModelError(null);
      try {
        await api.setAgentModel(resolvedAgentId, trimmed);
        await fetchAgents();
        setModelSave("saved");
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => setModelSave("idle"), 1800);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to save";
        setModelError(msg);
        setModelSave("error");
        showToast(`Error: ${msg}`, true);
      }
    },
    [agent?.model, fetchAgents, resolvedAgentId, showToast],
  );

  return (
    <div className="page-content">
      <div className="agent-settings-section">
        <div className="agent-settings-heading-row">
          <h3 className="agent-settings-heading">Model</h3>
          <span
            className={`agent-settings-save-pill${
              modelSave === "saved" || modelSave === "error"
                ? " agent-settings-save-pill--visible"
                : ""
            }${modelSave === "error" ? " agent-settings-save-pill--error" : ""}`}
            role="status"
            aria-live="polite"
          >
            <span className="agent-settings-save-pill-dot" aria-hidden="true" />
            {modelSave === "saved" ? "Saved" : modelSave === "error" ? modelError : ""}
          </span>
        </div>
        <ModelPicker value={localModel} onChange={saveModel} disabled={modelSave === "saving"} />
      </div>

      <div className="agent-settings-section">
        <h3 className="agent-settings-heading">Details</h3>
        <div className="agent-settings-grid">
          <div className="agent-settings-field">
            <span className="agent-settings-label">Status</span>
            <span className="agent-settings-value">
              <span
                className={`agent-settings-status-dot ${agent?.status === "active" ? "live" : ""}`}
              />
              {agent?.status || "unknown"}
            </span>
          </div>
          {agent?.execution_mode && (
            <div className="agent-settings-field">
              <span className="agent-settings-label">Mode</span>
              <span className="agent-settings-value">{agent.execution_mode}</span>
            </div>
          )}
          {agent?.workdir && (
            <div className="agent-settings-field">
              <span className="agent-settings-label">Workdir</span>
              <span className="agent-settings-value agent-settings-mono">{agent.workdir}</span>
            </div>
          )}
          <div className="agent-settings-field">
            <span className="agent-settings-label">ID</span>
            <span className="agent-settings-value">
              <span className="agent-id-pill">{agent?.id || agentId}</span>
            </span>
          </div>
          {agent?.created_at && (
            <div className="agent-settings-field">
              <span className="agent-settings-label">Created</span>
              <span className="agent-settings-value">{formatMediumDate(agent.created_at)}</span>
            </div>
          )}
        </div>
      </div>

      <DangerZone
        agent={agent}
        resolvedAgentId={resolvedAgentId}
        directChildren={childAgents.length}
        showToast={showToast}
      />
    </div>
  );
}

function DangerZone({
  agent,
  resolvedAgentId,
  directChildren,
  showToast,
}: {
  agent: ReturnType<typeof useDaemonStore.getState>["agents"][0] | undefined;
  resolvedAgentId: string;
  directChildren: number;
  showToast: (msg: string, isError?: boolean) => void;
}) {
  const navigate = useNavigate();
  const fetchAgents = useDaemonStore((s) => s.fetchAgents);
  const entitiesList = useDaemonStore((s) => s.entities);
  const [cascade, setCascade] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const agentName = agent?.name || resolvedAgentId;
  const otherAgentsInEntity = useDaemonStore
    .getState()
    .agents.filter(
      (a) => a.trust_id && a.trust_id === agent?.trust_id && a.id !== agent?.id,
    ).length;
  const isRoot = otherAgentsInEntity === 0;
  const canConfirm = confirmText.trim() === agentName && !deleting;

  const handleDelete = async () => {
    if (!canConfirm) return;
    setDeleting(true);
    try {
      const res = await api.deleteAgent(resolvedAgentId, { cascade });
      if (!res.ok) {
        showToast(res.error || "Delete failed", true);
        setDeleting(false);
        return;
      }
      const count = res.deleted ?? 1;
      showToast(`Deleted ${count} agent${count === 1 ? "" : "s"}`);
      await fetchAgents();
      if (agent?.trust_id) {
        navigate(entityPathFromId(entitiesList, agent.trust_id));
      } else {
        navigate("/");
      }
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Delete failed"}`, true);
      setDeleting(false);
    }
  };

  return (
    <div className="agent-danger">
      <h3 className="agent-danger-heading">Danger zone</h3>
      <p className="agent-danger-copy">
        Deleting this agent removes its quests, ideas, events, and session history. This cannot be
        undone.
      </p>

      <div className="agent-danger-modes">
        <label
          className={`agent-danger-mode${directChildren === 0 ? " agent-danger-mode--disabled" : ""}`}
        >
          <input
            type="radio"
            name="delete-mode"
            checked={!cascade}
            disabled={directChildren === 0}
            onChange={() => setCascade(false)}
          />
          <span className="agent-danger-mode-body">
            <span className="agent-danger-mode-label">
              Promote children
              {directChildren > 0 && (
                <>
                  {" · "}
                  {directChildren} {directChildren === 1 ? "agent" : "agents"}
                </>
              )}
            </span>
            <span className="agent-danger-mode-hint">
              {directChildren === 0
                ? "No direct children — cascade is the only option."
                : isRoot
                  ? "Children become roots of their own workspaces."
                  : "Children move up to this agent's parent."}
            </span>
          </span>
        </label>

        <label className="agent-danger-mode">
          <input
            type="radio"
            name="delete-mode"
            checked={cascade || directChildren === 0}
            onChange={() => setCascade(true)}
          />
          <span className="agent-danger-mode-body">
            <span className="agent-danger-mode-label">Cascade — wipe the subtree</span>
            <span className="agent-danger-mode-hint">
              Deletes this agent and every descendant. Everything they own goes with them.
            </span>
          </span>
        </label>
      </div>

      <div className="agent-danger-confirm">
        <label className="agent-danger-confirm-label" htmlFor="agent-danger-confirm-input">
          Type <span className="agent-danger-confirm-name">{agentName}</span> to confirm
        </label>
        <input
          id="agent-danger-confirm-input"
          className="agent-danger-confirm-input"
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={agentName}
          autoComplete="off"
          spellCheck={false}
        />
        <div className="agent-danger-actions">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleDelete}
            disabled={!canConfirm}
            className="agent-danger-btn"
          >
            {deleting
              ? "Deleting…"
              : cascade || directChildren === 0
                ? "Delete agent and subtree"
                : "Delete agent"}
          </Button>
        </div>
      </div>
    </div>
  );
}
