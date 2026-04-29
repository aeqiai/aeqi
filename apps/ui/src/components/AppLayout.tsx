import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import CommandPalette from "./CommandPalette";
import AgentPage from "./AgentPage";
import LeftSidebar from "./shell/LeftSidebar";
import SessionsRail from "./shell/SessionsRail";
import ComposerRow from "./shell/ComposerRow";
import BootLoader from "./shell/BootLoader";
import ShortcutsOverlay from "./ShortcutsOverlay";
import { useDaemonStore } from "@/store/daemon";
import { useInboxStore } from "@/store/inbox";
import { useUIStore } from "@/store/ui";
import { useAuthStore } from "@/store/auth";
import { useDaemonSocket } from "@/hooks/useDaemonSocket";
import { useShellSurface } from "@/hooks/useShellSurface";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { isRateLimited } from "@/lib/rateLimit";
import RateLimitBanner from "./shell/RateLimitBanner";
import ProjectsPage from "@/pages/ProjectsPage";
import CRMPage from "@/pages/CRMPage";
import MetricsPage from "@/pages/MetricsPage";
import OwnershipPage from "@/pages/OwnershipPage";
import TreasuryPage from "@/pages/TreasuryPage";
import GovernancePage from "@/pages/GovernancePage";
import type { Agent } from "@/lib/types";

const DrivePage = lazy(() => import("@/pages/DrivePage"));
const ProfilePage = lazy(() => import("@/pages/ProfilePage"));
const StartPage = lazy(() => import("@/pages/StartPage"));
const EconomyPage = lazy(() => import("@/pages/EconomyPage"));
const CompanyPage = lazy(() => import("@/pages/CompanyPage"));
const HomeDashboard = lazy(() => import("./HomeDashboard"));
const UserInboxSessionView = lazy(() => import("./inbox/UserInboxSessionView"));

// Tabs whose content is wrapped by CompanyPage's PageRail (Overview /
// Positions / Agents / Events / Quests / Ideas). Every other agent-
// scoped tab (sessions, settings, channels, tools, integrations, plan)
// renders bare AgentPage so it doesn't get a duplicate rail.
const COMPANY_PAGERAIL_TABS = new Set([
  "overview",
  "positions",
  "agents",
  "events",
  "quests",
  "ideas",
]);

const COMPANY_TABS = new Set([
  "agents",
  "crm",
  "drive",
  "events",
  "governance",
  "ideas",
  "integrations",
  "metrics",
  "overview",
  "ownership",
  "plan",
  "projects",
  "quests",
  "settings",
  "tools",
  "treasury",
]);

const COMPANY_ROOT_TABS = new Set([
  "agents",
  "crm",
  "drive",
  "events",
  "governance",
  "ideas",
  "metrics",
  "overview",
  "ownership",
  "positions",
  "projects",
  "quests",
  "treasury",
]);

function findEntity(agents: Agent[], id: string): Agent | null {
  const start = agents.find((a) => a.id === id);
  if (!start) return null;
  const eid = start.entity_id;
  if (!eid) return start;
  return agents.find((a) => a.id === eid) || start;
}

export default function AppLayout() {
  const location = useLocation();
  const [searching, setSearching] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const {
    agentId = "",
    tab,
    itemId,
  } = useParams<{
    agentId?: string;
    tab?: string;
    itemId?: string;
  }>();
  const path = location.pathname;

  const agents = useDaemonStore((s) => s.agents);
  const setActiveEntity = useUIStore((s) => s.setActiveEntity);
  const activeEntity = useUIStore((s) => s.activeEntity);

  // Declared above any conditional return so the inbox-agent hook below
  // can read surface.userSessionId without violating React's rules-of-hooks.
  const surface = useShellSurface(path, agentId, tab);
  const inboxAgentId = useInboxStore((s) =>
    surface.userSessionId
      ? (s.items.find((i) => i.session_id === surface.userSessionId)?.agent_id ?? null)
      : null,
  );

  const { currentAgent, rootAgent } = useMemo(() => {
    const current = agents.find((a) => a.id === agentId || a.name === agentId) || null;
    const root = current ? findEntity(agents, current.id) : null;
    return {
      currentAgent: current,
      rootAgent: root,
    };
  }, [agents, agentId]);

  // We never fall back to the raw URL agentId here — a non-agent segment
  // (e.g. "profile") would otherwise get cached as the active entity.
  const entities = useDaemonStore((s) => s.entities);
  const firstRoot = useMemo(() => entities[0]?.id ?? null, [entities]);
  const activeEntityValid = useMemo(
    () => (activeEntity && agents.some((a) => a.id === activeEntity) ? activeEntity : null),
    [agents, activeEntity],
  );
  const entityId = rootAgent?.id || activeEntityValid || firstRoot || "";

  // Only commit a verified-real entity — otherwise the pre-load render
  // can persist a bogus value into localStorage.
  useEffect(() => {
    if (entityId && agents.some((a) => a.id === entityId)) setActiveEntity(entityId);
  }, [entityId, agents, setActiveEntity]);

  useEffect(() => {
    const titles: Record<string, string> = {
      sessions: "home",
      channels: "Channels",
      drive: "Drive",
      settings: "Settings",
      tools: "Tools",
      profile: "Profile",
      billing: "Billing",
      agents: "Agents",
      events: "Events",
      quests: "Quests",
      ideas: "Ideas",
      projects: "Projects",
      overview: "Overview",
      crm: "CRM",
      metrics: "Metrics",
      ownership: "Ownership",
      treasury: "Treasury",
      governance: "Governance",
    };
    const section = tab || "sessions";
    const sectionTitle = titles[section] || section;
    const agentLabel = currentAgent?.name;
    document.title = agentLabel ? `${sectionTitle} — ${agentLabel} · æqi` : "æqi";
  }, [tab, currentAgent]);

  // Pause the periodic refresh while rate-limited — polling while blocked
  // just piles on more 429s and extends the window the user is stuck in.
  const fetchAll = useDaemonStore((s) => s.fetchAll);
  useEffect(() => {
    fetchAll();
    const i = setInterval(() => {
      if (isRateLimited()) return;
      fetchAll();
    }, 30000);
    return () => clearInterval(i);
  }, [fetchAll, entityId]);
  useDaemonSocket();

  const openSearch = useCallback(() => setSearching(true), []);
  const closeSearch = useCallback(() => setSearching(false), []);
  const companyNavId = entityId || agentId;
  useGlobalShortcuts({
    agentId: companyNavId,
    searching,
    shortcutsOpen,
    openSearch,
    closeSearch,
    setShortcutsOpen,
  });

  const initialLoaded = useDaemonStore((s) => s.initialLoaded);
  const appMode = useAuthStore((s) => s.appMode);

  const { isHome, isSettings, isEconomy, isDrive, isStart, isUserSession, userSessionId } = surface;

  if (!initialLoaded) return <BootLoader />;

  const encodedEntityId = entityId ? encodeURIComponent(entityId) : "";
  const search = location.search || "";

  // Company context is canonical in the URL. Without this, the sidebar can
  // display the selected company from localStorage while links still resolve
  // as top-level routes (`/quests`), which React then misreads as `:agentId`.
  if (isHome && encodedEntityId) {
    return <Navigate to={`/${encodedEntityId}${search}`} replace />;
  }

  // Defensive migration for old top-level primitive URLs. Keep the item
  // segment if present (`/quests/q-1` -> `/:entityId/quests/q-1`).
  if (agentId && !currentAgent && COMPANY_TABS.has(agentId) && encodedEntityId) {
    const item = tab ? `/${encodeURIComponent(tab)}` : "";
    return <Navigate to={`/${encodedEntityId}/${agentId}${item}${search}`} replace />;
  }

  // Company primitives are scoped to the root company, not whichever child
  // agent was last opened. Old deep links such as `/eng/quests/q-1` should
  // land on `/company/quests/q-1` so Quests never depend on child-agent URLs.
  if (
    currentAgent &&
    rootAgent &&
    rootAgent.id !== currentAgent.id &&
    tab &&
    COMPANY_ROOT_TABS.has(tab)
  ) {
    const item = itemId ? `/${encodeURIComponent(itemId)}` : "";
    return (
      <Navigate
        to={`/${encodeURIComponent(rootAgent.id)}/${encodeURIComponent(tab)}${item}${search}`}
        replace
      />
    );
  }

  // Stale entity ref after a data reset would point at a non-existent
  // agent. Bounce home — NOT to /new directly, which can self-loop when
  // a placement exists without a matching runtime agent.
  if (agentId && !currentAgent) {
    localStorage.removeItem("aeqi_entity");
    return <Navigate to="/" replace />;
  }

  const base = agentId ? `/${encodeURIComponent(agentId)}` : "/";
  // No-tab at entity scope renders Overview; no-tab at user scope renders
  // the Inbox.
  const effectiveTab = tab || (agentId ? "overview" : "sessions");

  // Runtime mode has no account-level identity surface.
  if (isSettings && appMode && appMode !== "platform") {
    return <Navigate to="/" replace />;
  }

  const mainContent = (() => {
    if (isStart) return <StartPage />;
    if (isUserSession && userSessionId) return <UserInboxSessionView sessionId={userSessionId} />;
    if (isHome) return <HomeDashboard />;
    if (isDrive) return <DrivePage />;
    if (isSettings) return <ProfilePage />;
    if (isEconomy) return <EconomyPage />;
    if (tab === "projects") return <ProjectsPage />;
    if (tab === "crm") return <CRMPage />;
    if (tab === "metrics") return <MetricsPage />;
    if (tab === "ownership") return <OwnershipPage />;
    if (tab === "treasury") return <TreasuryPage />;
    if (tab === "governance") return <GovernancePage />;
    if (agentId && COMPANY_PAGERAIL_TABS.has(effectiveTab)) {
      return <CompanyPage agentId={agentId} tab={effectiveTab} itemId={itemId} />;
    }
    return <AgentPage agentId={agentId} tab={effectiveTab} itemId={itemId} />;
  })();

  const sessionsMounted =
    isUserSession ||
    (!isDrive && !isSettings && !isHome && !isStart && !isEconomy && effectiveTab === "sessions");
  const showComposer = sessionsMounted;
  // inbox-mode: at / and /sessions/:id (user scope) — items across all agents.
  // agent-mode: at /:agentId/sessions[/...] — that agent's sessions only.
  const inboxRail = (isHome || isUserSession) && !isSettings && !isEconomy && !isStart;
  const agentRail =
    effectiveTab === "sessions" && !!agentId && !isSettings && !isDrive && !isHome && !isStart;
  const showSessionsRail = inboxRail || agentRail;
  const railMode: "inbox" | "agent" = inboxRail ? "inbox" : "agent";

  return (
    <>
      <div className="shell">
        <LeftSidebar agentId={companyNavId} path={path} />

        <div className="content-column">
          <div className="content-card">
            <div className="content-paper">
              <div className="content-body-row">
                {showSessionsRail && (
                  <aside className="sessions-rail-col">
                    <SessionsRail mode={railMode} selectedSessionId={userSessionId} />
                  </aside>
                )}
                <div className="content-main-col">
                  <div className="content-scroll">
                    <Suspense fallback={null}>{mainContent}</Suspense>
                  </div>
                  {showComposer && (
                    <ComposerRow
                      agentId={agentId || inboxAgentId || null}
                      base={base}
                      sessionsMounted={sessionsMounted}
                      sessionId={isUserSession ? userSessionId : undefined}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
          <RateLimitBanner />
        </div>
      </div>
      <CommandPalette open={searching} onClose={closeSearch} />
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </>
  );
}
