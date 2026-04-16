import { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation, useSearchParams, useParams, Outlet } from "react-router-dom";
import AgentTree from "./Sidebar";
import ContextDrawer from "./ContextDrawer";
import CommandPalette from "./CommandPalette";
import AgentPage from "./AgentPage";
import CompanySwitcher from "./CompanySwitcher";
import ContentTopBar from "./ContentTopBar";
import { useDaemonStore } from "@/store/daemon";
import { useAuthStore } from "@/store/auth";
import { useUIStore } from "@/store/ui";
import { useDaemonSocket } from "@/hooks/useDaemonSocket";
import RoundAvatar from "./RoundAvatar";

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [searching, setSearching] = useState(false);

  const routeParams = useParams<{
    company?: string;
    agentId?: string;
    tab?: string;
    itemId?: string;
  }>();
  const company = routeParams.company || "";
  const agentId = routeParams.agentId || params.get("agent");
  const path = location.pathname;
  const appMode = useAuthStore((s) => s.appMode);
  const user = useAuthStore((s) => s.user);
  const authMode = useAuthStore((s) => s.authMode);
  const userName = user?.name || (authMode === "none" ? "Local" : "Account");

  // Sync company from URL param into store + localStorage.
  const setActiveCompany = useUIStore((s) => s.setActiveCompany);
  useEffect(() => {
    if (company) {
      setActiveCompany(company);
    }
  }, [company, setActiveCompany]);

  const fetchAll = useDaemonStore((s) => s.fetchAll);
  const agents = useDaemonStore((s) => s.agents);
  useEffect(() => {
    fetchAll();
    const i = setInterval(fetchAll, 30000);
    return () => clearInterval(i);
  }, [fetchAll, company]);
  useDaemonSocket();

  const openSearch = useCallback(() => setSearching(true), []);
  const closeSearch = useCallback(() => setSearching(false), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (searching) closeSearch();
        else openSearch();
      }
      if (e.key === "Escape" && searching) {
        closeSearch();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [searching, openSearch, closeSearch]);

  // Company-scoped navigation helpers.
  const base = `/${encodeURIComponent(company)}`;
  const isActive = (p: string) => {
    if (agentId) return false;
    const full = p === "/" ? base : `${base}${p}`;
    if (p === "/") return path === base || path === `${base}/`;
    return path === full || path.startsWith(`${full}/`);
  };
  const go = (p: string) => navigate(p === "/" ? base : `${base}${p}`);
  const href = (p: string) => (p === "/" ? base : `${base}${p}`);

  const initialLoaded = useDaemonStore((s) => s.initialLoaded);

  if (!initialLoaded) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          background: "var(--bg-primary, #fafafa)",
        }}
      >
        <span
          style={{
            fontSize: 32,
            fontWeight: 700,
            color: "rgba(0,0,0,0.15)",
            animation: "ae-pulse 1.6s ease-in-out infinite",
          }}
        >
          æ
        </span>
        <style>{`@keyframes ae-pulse { 0%, 100% { opacity: 0.15; transform: scale(1); } 50% { opacity: 0.6; transform: scale(1.05); } }`}</style>
      </div>
    );
  }

  const navLink = (p: string, label: string, icon: React.ReactNode, action?: string) => (
    <a
      className={`sidebar-nav-item ${isActive(p) ? "active" : ""}`}
      href={href(p)}
      onClick={(e) => {
        e.preventDefault();
        go(p);
      }}
    >
      {icon}
      <span className="sidebar-nav-label">{label}</span>
      {action && (
        <span
          className="sidebar-nav-action"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            go(p);
            setTimeout(() => window.dispatchEvent(new CustomEvent("aeqi:create")), 50);
          }}
          title={action}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <path d="M6 2.5v7M2.5 6h7" />
          </svg>
        </span>
      )}
    </a>
  );

  const homeIcon = (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    >
      <path d="M2 7.5l5-4.5 5 4.5" />
      <path d="M3.5 6.5v5a.5.5 0 00.5.5h2.5V9.5h1V12H10a.5.5 0 00.5-.5v-5" />
    </svg>
  );

  return (
    <>
      <div className="shell">
        {/* Left sidebar */}
        <div className="left-sidebar">
          {/* Brand mark — click to go home */}
          <a
            className="sidebar-brand"
            href={href("/")}
            onClick={(e) => {
              e.preventDefault();
              go("/");
            }}
          >
            æq<span style={{ display: "inline-block", transform: "translateY(0.05em)" }}>i</span>
          </a>

          {/* Scope indicator */}
          {agentId ? (
            <>
              <div className="sidebar-scope">
                <RoundAvatar name={agents.find((a) => a.id === agentId || a.name === agentId)?.name || agentId} size={18} />
                <span className="sidebar-scope-name">
                  {agents.find((a) => a.id === agentId || a.name === agentId)?.display_name ||
                    agents.find((a) => a.id === agentId || a.name === agentId)?.name ||
                    agentId}
                </span>
              </div>
              <a
                className="sidebar-back"
                href={href("/agents")}
                onClick={(e) => {
                  e.preventDefault();
                  go("/agents");
                }}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <path d="M7.5 2L3.5 6l4 4" />
                </svg>
                Back
              </a>
            </>
          ) : (
            <div className="sidebar-scope">
              <span className="sidebar-scope-name">{company}</span>
            </div>
          )}

          <div className="sidebar-section-label">aeqi</div>
          <nav className="sidebar-nav">
            {navLink("/", "Dashboard", homeIcon)}
            {navLink(
              "/settings",
              "Settings",
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
              </svg>,
            )}
            {navLink(
              "/sessions",
              "Sessions",
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              >
                <path d="M2 3h10v7a1 1 0 01-1 1H3a1 1 0 01-1-1V3z" />
                <path d="M5 6h4M5 8.5h2" />
              </svg>,
            )}
            {navLink(
              "/agents",
              "Agents",
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
              >
                <circle cx="7" cy="5" r="2.5" />
                <path d="M3 12.5c0-2.2 1.8-4 4-4s4 1.8 4 4" />
              </svg>,
              "New agent",
            )}
            {navLink(
              "/events",
              "Events",
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              >
                <polyline points="1 7 4 4 7 9 10 3 13 7" />
              </svg>,
            )}
            {navLink(
              "/quests",
              "Quests",
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
              >
                <path d="M4 3h8M4 7h8M4 11h6M2 3v0.4.0v0M2 11v0" strokeLinecap="round" />
              </svg>,
              "New quest",
            )}
            {navLink(
              "/ideas",
              "Ideas",
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
              >
                <path
                  d="M7 2v2M7 10v2M2 7h2M10 7h2M3.8 3.8l1.4 1.4M8.8 8.8l1.4 1.4M10.2 3.8l-1.4 1.4M5.2 8.8l-1.4 1.4"
                  strokeLinecap="round"
                />
              </svg>,
              "New idea",
            )}
            {navLink(
              "/tools",
              "Tools",
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              >
                <path d="M8.5 2.5l3 3-7.5 7.5H1v-3l7.5-7.5z" />
              </svg>,
            )}
          </nav>
          <div className="left-sidebar-body">
            <AgentTree />
          </div>
          {appMode === "platform" && (
            <nav className="sidebar-nav" style={{ marginTop: "auto" }}>
              <a
                className={`sidebar-nav-item ${isActive("/account") ? "active" : ""}`}
                href={href("/account")}
                onClick={(e) => {
                  e.preventDefault();
                  go("/account");
                }}
              >
                <RoundAvatar name={userName} size={22} src={user?.avatar_url} />
                <span className="sidebar-nav-label">Account</span>
              </a>
            </nav>
          )}
          <div className="sidebar-footer">
            <a href="https://aeqi.ai/docs" target="_blank" rel="noopener">
              Docs
            </a>
            <span className="sidebar-footer-dot">·</span>
            <span className="sidebar-footer-version">v{__APP_VERSION__}</span>
          </div>
        </div>

        {/* Main content */}
        <div className="content-area">
          {agentId ? (
            <AgentPage agentId={agentId} />
          ) : (
            <>
              <ContentTopBar />
              <div className="content-scroll">
                <Outlet />
              </div>
            </>
          )}
        </div>

        {/* Right context drawer */}
        <ContextDrawer agentId={agentId} sessionId={routeParams.itemId || null} />
      </div>
      <CommandPalette open={searching} onClose={closeSearch} />
    </>
  );
}
