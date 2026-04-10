import { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation, useSearchParams, Outlet } from "react-router-dom";
import AgentTree from "./Sidebar";
import ContextDrawer from "./ContextDrawer";
import CommandPalette from "./CommandPalette";
import AgentSessionView from "./AgentSessionView";
import SessionRail from "./SessionRail";
import WorkspaceSwitcher from "./WorkspaceSwitcher";
import ContentTopBar from "./ContentTopBar";
import { useDaemonStore } from "@/store/daemon";
import { useAuthStore } from "@/store/auth";
import { useDaemonSocket } from "@/hooks/useDaemonSocket";
import RoundAvatar from "./RoundAvatar";

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [searching, setSearching] = useState(false);

  const agentId = params.get("agent");
  const sessionId = params.get("session");
  const path = location.pathname;
  const user = useAuthStore((s) => s.user);
  const authMode = useAuthStore((s) => s.authMode);
  const userName = user?.name || (authMode === "none" ? "Local" : "Account");

  const fetchAll = useDaemonStore((s) => s.fetchAll);
  useEffect(() => {
    fetchAll();
    const i = setInterval(fetchAll, 30000);
    return () => clearInterval(i);
  }, [fetchAll]);
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

  const isActive = (p: string) => {
    if (p === "/") return path === "/" && !agentId;
    return path.startsWith(p) && !agentId;
  };

  const initialLoaded = useDaemonStore((s) => s.initialLoaded);

  if (!initialLoaded) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "var(--bg-primary, #fafafa)" }}>
        <span style={{ fontSize: 32, fontWeight: 700, color: "rgba(0,0,0,0.15)", animation: "ae-pulse 1.6s ease-in-out infinite" }}>æ</span>
        <style>{`@keyframes ae-pulse { 0%, 100% { opacity: 0.15; transform: scale(1); } 50% { opacity: 0.6; transform: scale(1.05); } }`}</style>
      </div>
    );
  }

  return (
    <>
      <div className="shell">
        {/* Left sidebar */}
        <div className="left-sidebar">
          <WorkspaceSwitcher />
          <nav className="sidebar-nav">
            <a className={`sidebar-nav-item ${isActive("/") ? "active" : ""}`} href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M2 7.5l5-4.5 5 4.5" /><path d="M3.5 6.5v5a.5.5 0 00.5.5h2.5V9.5h1V12H10a.5.5 0 00.5-.5v-5" /></svg>
              <span className="sidebar-nav-label">Home</span>
            </a>
            <a className={`sidebar-nav-item sidebar-nav-market ${isActive("/market") ? "active" : ""}`} href="/market" onClick={(e) => { e.preventDefault(); navigate("/market"); }}>
              <span style={{ fontSize: 16, fontWeight: 700, lineHeight: 1, width: 22, textAlign: "center" as const, flexShrink: 0, display: "inline-flex", justifyContent: "center" }}>æ</span>
              <span className="sidebar-nav-label">Market</span>
            </a>
          </nav>
          <nav className="sidebar-nav">
            <a className={`sidebar-nav-item ${isActive("/company") ? "active" : ""}`} href="/company" onClick={(e) => { e.preventDefault(); navigate("/company"); }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><rect x="2" y="4" width="10" height="8" rx="1" /><path d="M5 4V3a2 2 0 014 0v1" /></svg>
              <span className="sidebar-nav-label">Company</span>
              <span className="sidebar-nav-action" onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate("/companies"); setTimeout(() => window.dispatchEvent(new CustomEvent("aeqi:create")), 50); }} title="New company">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M6 2.5v7M2.5 6h7" /></svg>
              </span>
            </a>
            <a className={`sidebar-nav-item ${isActive("/treasury") ? "active" : ""}`} href="/treasury" onClick={(e) => { e.preventDefault(); navigate("/treasury"); }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M2 5l5-2.5L12 5" /><path d="M3 5.5v5M5.5 5.5v5M8.5 5.5v5M11 5.5v5" /><path d="M1.5 10.5h11" /><path d="M1 12h12" /></svg>
              <span className="sidebar-nav-label">Treasury</span>
              <span className="sidebar-nav-action" onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate("/treasury"); setTimeout(() => window.dispatchEvent(new CustomEvent("aeqi:create")), 50); }} title="New transaction">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M6 2.5v7M2.5 6h7" /></svg>
              </span>
            </a>
            <a className={`sidebar-nav-item ${isActive("/drive") ? "active" : ""}`} href="/drive" onClick={(e) => { e.preventDefault(); navigate("/drive"); }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M2 4.5h10M2 4.5v6a1 1 0 001 1h8a1 1 0 001-1v-6M5 2.5h4a1 1 0 011 1v1H4v-1a1 1 0 011-1z" /></svg>
              <span className="sidebar-nav-label">Drive</span>
              <span className="sidebar-nav-action" onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate("/drive"); setTimeout(() => window.dispatchEvent(new CustomEvent("aeqi:create")), 50); }} title="Upload file">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M6 2.5v7M2.5 6h7" /></svg>
              </span>
            </a>
            <a className={`sidebar-nav-item ${isActive("/apps") ? "active" : ""}`} href="/apps" onClick={(e) => { e.preventDefault(); navigate("/apps"); }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><rect x="2" y="2" width="4" height="4" rx="0.5" /><rect x="8" y="2" width="4" height="4" rx="0.5" /><rect x="2" y="8" width="4" height="4" rx="0.5" /><rect x="8" y="8" width="4" height="4" rx="0.5" /></svg>
              <span className="sidebar-nav-label">Apps</span>
              <span className="sidebar-nav-action" onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate("/apps"); setTimeout(() => window.dispatchEvent(new CustomEvent("aeqi:create")), 50); }} title="New app">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M6 2.5v7M2.5 6h7" /></svg>
              </span>
            </a>
          </nav>
          <nav className="sidebar-nav">
            <a className={`sidebar-nav-item ${isActive("/agents") ? "active" : ""}`} href="/agents" onClick={(e) => { e.preventDefault(); navigate("/agents"); }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="7" cy="5" r="2.5" /><path d="M3 12.5c0-2.2 1.8-4 4-4s4 1.8 4 4" /></svg>
              <span className="sidebar-nav-label">Agents</span>
              <span className="sidebar-nav-action" onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate("/agents"); setTimeout(() => window.dispatchEvent(new CustomEvent("aeqi:create")), 50); }} title="New agent">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M6 2.5v7M2.5 6h7" /></svg>
              </span>
            </a>
            <a className={`sidebar-nav-item ${isActive("/events") ? "active" : ""}`} href="/events" onClick={(e) => { e.preventDefault(); navigate("/events"); }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><rect x="2" y="2" width="10" height="10" rx="1.5" /><path d="M2 8.5h3l1 1.5h2l1-1.5h3" /></svg>
              <span className="sidebar-nav-label">Events</span>
              <span className="sidebar-nav-action" onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate("/events"); setTimeout(() => window.dispatchEvent(new CustomEvent("aeqi:create")), 50); }} title="New event">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M6 2.5v7M2.5 6h7" /></svg>
              </span>
            </a>
            <a className={`sidebar-nav-item ${isActive("/quests") ? "active" : ""}`} href="/quests" onClick={(e) => { e.preventDefault(); navigate("/quests"); }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M4 3h8M4 7h8M4 11h6M2 3v0.4.0v0M2 11v0" strokeLinecap="round" /></svg>
              <span className="sidebar-nav-label">Quests</span>
              <span className="sidebar-nav-action" onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate("/quests"); setTimeout(() => window.dispatchEvent(new CustomEvent("aeqi:create")), 50); }} title="New quest">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M6 2.5v7M2.5 6h7" /></svg>
              </span>
            </a>
            <a className={`sidebar-nav-item ${isActive("/insights") ? "active" : ""}`} href="/insights" onClick={(e) => { e.preventDefault(); navigate("/insights"); }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M7 2v2M7 10v2M2 7h2M10 7h2M3.8 3.8l1.4 1.4M8.8 8.8l1.4 1.4M10.2 3.8l-1.4 1.4M5.2 8.8l-1.4 1.4" strokeLinecap="round" /></svg>
              <span className="sidebar-nav-label">Insights</span>
              <span className="sidebar-nav-action" onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate("/insights"); setTimeout(() => window.dispatchEvent(new CustomEvent("aeqi:create")), 50); }} title="New insight">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M6 2.5v7M2.5 6h7" /></svg>
              </span>
            </a>
          </nav>
          <div className="left-sidebar-body">
            <AgentTree />
          </div>
          <nav className="sidebar-nav" style={{ marginTop: "auto" }}>
            <a className={`sidebar-nav-item ${isActive("/account") ? "active" : ""}`} href="/account" onClick={(e) => { e.preventDefault(); navigate("/account"); }}>
              {user?.avatar_url ? (
                <img src={user.avatar_url} alt="" style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0 }} />
              ) : (
                <RoundAvatar name={userName} size={22} />
              )}
              <span className="sidebar-nav-label">Account</span>
            </a>
          </nav>
          <div className="sidebar-footer">
            <a href="https://aeqi.ai/docs" target="_blank" rel="noopener">Docs</a>
            <span className="sidebar-footer-dot">·</span>
            <span className="sidebar-footer-version">v0.4.0</span>
          </div>
        </div>

        {/* Main content */}
        <div className="content-area">
          {agentId ? (
            <div className="content-agent-layout">
              <SessionRail agentId={agentId} activeSessionId={sessionId} />
              <AgentSessionView agentId={agentId} sessionId={sessionId} />
            </div>
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
        <ContextDrawer agentId={agentId} sessionId={sessionId} />
      </div>
      <CommandPalette open={searching} onClose={closeSearch} />
    </>
  );
}
