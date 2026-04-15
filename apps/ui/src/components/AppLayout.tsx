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

  const companyIcon = (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    >
      <rect x="2" y="4" width="10" height="8" rx="1" />
      <path d="M5 4V3a2 2 0 014 0v1" />
    </svg>
  );

  return (
    <>
      <div className="shell">
        {/* Left sidebar */}
        <div className="left-sidebar">
          <CompanySwitcher />
          {appMode === "platform" ? (
            <>
              <nav className="sidebar-nav">
                {navLink("/", "Home", homeIcon)}
                <a
                  className={`sidebar-nav-item sidebar-nav-market ${isActive("/market") ? "active" : ""}`}
                  href={href("/market")}
                  onClick={(e) => {
                    e.preventDefault();
                    go("/market");
                  }}
                >
                  <span
                    style={{
                      fontSize: 16,
                      fontWeight: 700,
                      lineHeight: 1,
                      width: 22,
                      textAlign: "center" as const,
                      flexShrink: 0,
                      display: "inline-flex",
                      justifyContent: "center",
                    }}
                  >
                    æ
                  </span>
                  <span className="sidebar-nav-label">Market</span>
                </a>
              </nav>
              <nav className="sidebar-nav">
                {navLink("/settings", "Company", companyIcon, "New company")}
                {navLink(
                  "/treasury",
                  "Treasury",
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  >
                    <path d="M2 5l5-2.5L12 5" />
                    <path d="M3 5.5v5M5.5 5.5v5M8.5 5.5v5M11 5.5v5" />
                    <path d="M1.5 10.5h11" />
                    <path d="M1 12h12" />
                  </svg>,
                  "New transaction",
                )}
                {navLink(
                  "/drive",
                  "Drive",
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  >
                    <path d="M2 4.5h10M2 4.5v6a1 1 0 001 1h8a1 1 0 001-1v-6M5 2.5h4a1 1 0 011 1v1H4v-1a1 1 0 011-1z" />
                  </svg>,
                  "Upload file",
                )}
                {navLink(
                  "/apps",
                  "Apps",
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  >
                    <rect x="2" y="2" width="4" height="4" rx="0.5" />
                    <rect x="8" y="2" width="4" height="4" rx="0.5" />
                    <rect x="2" y="8" width="4" height="4" rx="0.5" />
                    <rect x="8" y="8" width="4" height="4" rx="0.5" />
                  </svg>,
                  "New app",
                )}
              </nav>
            </>
          ) : (
            <nav className="sidebar-nav">
              {navLink("/", "Home", homeIcon)}
              <a
                className={`sidebar-nav-item ${path === "/" ? "active" : ""}`}
                href="/"
                onClick={(e) => {
                  e.preventDefault();
                  navigate("/");
                }}
              >
                {companyIcon}
                <span className="sidebar-nav-label">Companies</span>
                <span
                  className="sidebar-nav-action"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    navigate("/new");
                  }}
                  title="New company"
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
              </a>
              {navLink("/settings", "Settings", companyIcon)}
            </nav>
          )}
          <nav className="sidebar-nav">
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
                <rect x="2" y="2" width="10" height="10" rx="1.5" />
                <path d="M2 8.5h3l1 1.5h2l1-1.5h3" />
              </svg>,
              "New event",
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
                <path d="M2.5 3.5h9v6h-5l-2.5 2v-2h-1.5z" />
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
