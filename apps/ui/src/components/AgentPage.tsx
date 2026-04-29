import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useNav } from "@/hooks/useNav";
import { useDaemonStore } from "@/store/daemon";
import { api } from "@/lib/api";
import AgentSessionView from "./AgentSessionView";
import AgentEventsTab from "./AgentEventsTab";
import AgentChannelsTab from "./AgentChannelsTab";
import AgentIdeasTab from "./AgentIdeasTab";
import AgentQuestsTab from "./AgentQuestsTab";
import EntityPositionsTab from "./EntityPositionsTab";
import EntityOverviewTab from "./EntityOverviewTab";
import AgentIntegrationsTab from "@/pages/Agent/Integrations";
import AgentPlanTab from "@/pages/Agent/PlanTab";
import AgentOrgChart from "./AgentOrgChart";
import PageRail from "./PageRail";
import { Button, EmptyState } from "./ui";
import ModelPicker from "./ModelPicker";
import { ALL_TOOLS, TOOL_BY_ID } from "@/lib/tools";

const SETTINGS_SUB_TABS = [
  { id: "settings", label: "Settings" },
  { id: "channels", label: "Channels" },
  { id: "tools", label: "Tools" },
  { id: "integrations", label: "Integrations" },
  { id: "plan", label: "Plan" },
];

// Routes that AgentPage knows how to render. No-tab resolves to the Sessions
// surface — the agent's home landing. ContentTopBar is the primary nav and
// lives outside of this component.
const TABS = [
  { id: "overview", label: "Overview" },
  { id: "sessions", label: "Sessions" },
  { id: "settings", label: "Settings" },
  { id: "positions", label: "Positions" },
  { id: "agents", label: "Agents" },
  { id: "events", label: "Events" },
  { id: "channels", label: "Channels" },
  { id: "quests", label: "Quests" },
  { id: "ideas", label: "Ideas" },
  { id: "tools", label: "Tools" },
  { id: "integrations", label: "Integrations" },
  { id: "plan", label: "Plan" },
];

export default function AgentPage({
  agentId,
  tab: tabProp,
  itemId: itemIdProp,
}: {
  agentId: string;
  tab?: string;
  itemId?: string | null;
}) {
  const { goAgent } = useNav();
  const params = useParams<{ tab?: string; itemId?: string }>();
  const routeTab = tabProp ?? params.tab;
  const itemId = itemIdProp ?? params.itemId;
  const activeTab = routeTab && TABS.some((t) => t.id === routeTab) ? routeTab : "sessions";
  const sessionId = activeTab === "sessions" ? itemId || null : null;

  const agents = useDaemonStore((s) => s.agents);
  const agent = agents.find((a) => a.id === agentId || a.name === agentId);

  const resolvedAgentId = agent?.id || agentId;

  // Child agents for the "agents" tab — every agent inside the same
  // entity is a candidate; AgentOrgChart filters down to the position
  // DAG when it renders.
  const childAgents = agents.filter(
    (a) => a.entity_id && a.entity_id === agent?.entity_id && a.id !== agent?.id,
  );

  // Save feedback toast
  const [toast, setToast] = useState<{ message: string; isError: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(null);

  const showToast = useCallback((message: string, isError = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, isError });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Save feedback toast */}
      {toast && (
        <div
          style={{
            padding: "8px 16px",
            margin: "8px 16px 0",
            borderRadius: 6,
            fontSize: 13,
            background: toast.isError ? "var(--error, #dc2626)" : "var(--success, #16a34a)",
            color: "var(--btn-primary-text)",
          }}
        >
          {toast.message}
        </div>
      )}

      {/* Tab content */}
      {activeTab === "overview" && <EntityOverviewTab entityId={resolvedAgentId} />}

      {activeTab === "sessions" && (
        <div className="agent-page-chat">
          <AgentSessionView agentId={agentId} sessionId={sessionId} />
        </div>
      )}

      {activeTab === "agents" && (
        <AgentsTab
          parentAgentId={resolvedAgentId}
          childAgents={childAgents}
          onSelectChild={(id) => goAgent(id)}
        />
      )}

      {activeTab === "quests" && <AgentQuestsTab agentId={resolvedAgentId} />}

      {activeTab === "ideas" && <AgentIdeasTab agentId={resolvedAgentId} />}

      {activeTab === "events" && <AgentEventsTab agentId={resolvedAgentId} />}

      {activeTab === "positions" && <EntityPositionsTab entityId={resolvedAgentId} />}

      {(activeTab === "settings" ||
        activeTab === "channels" ||
        activeTab === "tools" ||
        activeTab === "integrations" ||
        activeTab === "plan") && (
        <SettingsShell>
          {activeTab === "settings" && (
            <SettingsPanel
              agent={agent}
              agentId={agentId}
              resolvedAgentId={resolvedAgentId}
              showToast={showToast}
            />
          )}
          {activeTab === "channels" && <AgentChannelsTab agentId={resolvedAgentId} />}
          {activeTab === "tools" && (
            <ToolsDetail agent={agent} resolvedAgentId={resolvedAgentId} showToast={showToast} />
          )}
          {activeTab === "integrations" && <AgentIntegrationsTab agentId={resolvedAgentId} />}
          {activeTab === "plan" && <AgentPlanTab agentId={resolvedAgentId} />}
        </SettingsShell>
      )}
    </div>
  );
}

/**
 * Agents sub-tab. Listens for the shared `aeqi:create` event (fired by the
 * tab's inline picker "New agent" CTA) and navigates to the full-page spawn
 * flow at `/new?parent=<parentAgentId>`. Creating an agent is a first-class
 * act — it gets a page, not a modal.
 */
function AgentsTab({
  parentAgentId,
  childAgents,
  onSelectChild,
}: {
  parentAgentId: string;
  childAgents: ReturnType<typeof useDaemonStore.getState>["agents"];
  onSelectChild: (id: string) => void;
}) {
  const navigate = useNavigate();
  const allAgents = useDaemonStore((s) => s.agents);
  const goToSpawn = useCallback(
    () => navigate(`/new?parent=${encodeURIComponent(parentAgentId)}`),
    [navigate, parentAgentId],
  );
  const goToImportBlueprint = useCallback(
    () => navigate(`/economy/blueprints?import_into=${encodeURIComponent(parentAgentId)}`),
    [navigate, parentAgentId],
  );
  useEffect(() => {
    window.addEventListener("aeqi:create", goToSpawn);
    return () => window.removeEventListener("aeqi:create", goToSpawn);
  }, [goToSpawn]);

  // Deep descendant count across the whole entity. Position-DAG awareness
  // doesn't add value here — every agent in the same entity counts.
  const totalDescendants = useMemo(() => {
    const parent = allAgents.find((a) => a.id === parentAgentId);
    if (!parent?.entity_id) return 0;
    return allAgents.filter((a) => a.entity_id === parent.entity_id && a.id !== parentAgentId)
      .length;
  }, [allAgents, parentAgentId]);

  if (childAgents.length === 0) {
    return (
      <div className="page-content" style={{ padding: 0 }}>
        <div style={{ padding: 16 }}>
          <EmptyState
            eyebrow="Agents"
            title="No sub-agents yet"
            description="Spawn a direct report and it joins the org chart under this agent."
            action={
              <Button variant="primary" onClick={goToSpawn}>
                Spawn sub-agent
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const deepOnly = totalDescendants > childAgents.length;

  return (
    <div className="agents-tab">
      <div className="agents-tab-head">
        <div className="agents-tab-stat">
          <span className="agents-tab-stat-count">{childAgents.length}</span>
          <span className="agents-tab-stat-label">
            {childAgents.length === 1 ? "direct report" : "direct reports"}
          </span>
          {deepOnly && (
            <>
              <span className="agents-tab-stat-sep" aria-hidden>
                ·
              </span>
              <span className="agents-tab-stat-count">{totalDescendants}</span>
              <span className="agents-tab-stat-label">in the tree</span>
            </>
          )}
        </div>
        <div className="agents-tab-actions">
          <Button variant="ghost" size="sm" onClick={goToImportBlueprint}>
            Import blueprint
          </Button>
          <Button variant="secondary" size="sm" onClick={goToSpawn}>
            Spawn sub-agent
          </Button>
        </div>
      </div>
      <div className="agents-tab-body">
        <AgentOrgChart parentAgentId={parentAgentId} onSelect={onSelectChild} />
      </div>
    </div>
  );
}

/**
 * Settings umbrella. Renders a hairline tab row across Settings / Channels /
 * Tools — the three "configure how this agent works" panes. Sidebar only shows
 * "Settings"; Channels + Tools are reached via this tab row (or directly by
 * URL — /channels and /tools still work as entry points). Tab row uses the
 * shared `PageTabs` primitive so Profile and Settings share one visual
 * treatment (one tab language across the app).
 */
function SettingsShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="page-rail-shell">
      <PageRail tabs={SETTINGS_SUB_TABS} mode="path" title="Settings" />
      <div className="page-rail-content settings-shell-body">{children}</div>
    </div>
  );
}

/**
 * Tools tab. No selection → inline picker grouped by category (agent
 * tools vs. shell/files/search/web). Selection → detail with toggle.
 */
function ToolsDetail({
  agent,
  resolvedAgentId,
  showToast,
}: {
  agent: ReturnType<typeof useDaemonStore.getState>["agents"][0] | undefined;
  resolvedAgentId: string;
  showToast: (msg: string, isError?: boolean) => void;
}) {
  const { itemId } = useParams<{ itemId?: string }>();
  const { goAgent, agentId: scopeAgentId } = useNav();
  const selected = itemId ? TOOL_BY_ID[itemId] : null;

  if (!selected) {
    const denied = agent?.tool_deny || [];
    const activeCount = ALL_TOOLS.length - denied.length;
    // Split into "agent tools" (aeqi category) and "global tools" (everything else).
    const agentTools = ALL_TOOLS.filter((t) => t.category === "aeqi");
    const globalTools = ALL_TOOLS.filter((t) => t.category !== "aeqi");
    const groups: Array<{ label: string; tools: typeof ALL_TOOLS }> = [
      { label: "agent tools", tools: agentTools },
      { label: "global tools", tools: globalTools },
    ];
    const openTool = (id: string) => scopeAgentId && goAgent(scopeAgentId, "tools", id);
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

  // question.ask uses the dedicated `can_ask_director` flag on the
  // agent (default off, opt-in) rather than the tool_deny array
  // (default on, opt-out). Surface stays uniform with the rest of the
  // tools tab; the toggle just routes through the right API for this
  // one tool id.
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
      <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, marginTop: 8 }}>
        {selected.description}
      </p>
      <div style={{ marginTop: 16, fontSize: 12, color: "var(--text-muted)" }}>
        Status:{" "}
        <span
          className="agent-settings-status-dot"
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: allowed ? "var(--success)" : "var(--text-muted)",
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
    if (!self?.entity_id) return [];
    return agents.filter((a) => a.entity_id === self.entity_id && a.id !== resolvedAgentId);
  }, [agents, resolvedAgentId]);

  // Optimistic local model state so the picker reflects the selection the
  // moment the radio flips, not when the refetch round-trips back.
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
              <span className="agent-settings-value">
                {new Date(agent.created_at).toLocaleDateString([], {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
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

/**
 * Delete-agent danger zone. Defaults to reparent (children survive, promoted
 * to the grandparent) because that's the non-destructive choice. Cascade is
 * behind a radio + type-to-confirm gate so it can't be triggered casually.
 * On success: refetches the agent list and navigates to the parent (or home
 * if this was a root). AppLayout's stale-agentId guard will bounce us home
 * anyway, but navigating explicitly avoids a flash of 404-ish state.
 */
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
  const [cascade, setCascade] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const agentName = agent?.name || resolvedAgentId;
  // A "root" agent (in this UI sense) is one that owns its entity end-to-end
  // — equivalent to "this is the only agent in the entity, deleting it will
  // orphan the company" for confirmation copy purposes.
  const otherAgentsInEntity = useDaemonStore
    .getState()
    .agents.filter(
      (a) => a.entity_id && a.entity_id === agent?.entity_id && a.id !== agent?.id,
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
      if (agent?.entity_id && agent.entity_id !== agent.id) {
        navigate(`/${agent.entity_id}`);
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
