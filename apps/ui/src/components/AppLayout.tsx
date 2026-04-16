import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useLocation, useSearchParams, useParams, Outlet } from "react-router-dom";
import AgentTree from "./Sidebar";
import CommandPalette from "./CommandPalette";
import AgentPage from "./AgentPage";
import ContentTopBar from "./ContentTopBar";
import ChatComposer from "./session/ChatComposer";
import { useDaemonStore } from "@/store/daemon";
import { useAuthStore } from "@/store/auth";
import { useChatStore } from "@/store/chat";
import { useUIStore } from "@/store/ui";
import { useDaemonSocket } from "@/hooks/useDaemonSocket";
import RoundAvatar from "./RoundAvatar";
import ContentCTA from "./ContentCTA";

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [searching, setSearching] = useState(false);

  const routeParams = useParams<{
    root?: string;
    agentId?: string;
    tab?: string;
    itemId?: string;
  }>();
  const path = location.pathname;
  // Detect the root agent's chat URL: `/:root/sessions(/:itemId)?`. AppLayout
  // renders AgentPage for these without requiring `/agents/:rootId` in the URL.
  const rootSessionMatch = !routeParams.agentId
    ? path.match(/^\/[^/]+\/sessions(?:\/([^/]+))?\/?$/)
    : null;
  const rootSessionItemId = rootSessionMatch?.[1] || null;
  const isRootChat = !!rootSessionMatch;
  const agentId =
    routeParams.agentId || params.get("agent") || (isRootChat ? routeParams.root || "" : null);
  const user = useAuthStore((s) => s.user);
  const authMode = useAuthStore((s) => s.authMode);
  const userName = user?.name || (authMode === "none" ? "Local" : "Profile");

  // Sync root from URL param into store + localStorage; on user-level pages
  // (e.g. /profile) the param is absent, so fall back to the last active root
  // so sidebar navigation still takes the user back to their workspace.
  const setActiveRoot = useUIStore((s) => s.setActiveRoot);
  const activeRoot = useUIStore((s) => s.activeRoot);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const rootId = routeParams.root || activeRoot || "";
  useEffect(() => {
    if (routeParams.root) {
      setActiveRoot(routeParams.root);
    }
  }, [routeParams.root, setActiveRoot]);

  const fetchAll = useDaemonStore((s) => s.fetchAll);
  const agents = useDaemonStore((s) => s.agents);
  useEffect(() => {
    fetchAll();
    const i = setInterval(fetchAll, 30000);
    return () => clearInterval(i);
  }, [fetchAll, rootId]);
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

  // Root-scoped navigation helpers.
  const base = `/${encodeURIComponent(rootId)}`;
  const isActive = (p: string) => {
    if (agentId) return false;
    const full = p === "/" ? base : `${base}${p}`;
    if (p === "/") return path === base || path === `${base}/`;
    return path === full || path.startsWith(`${full}/`);
  };
  const go = (p: string) => navigate(p === "/" ? base : `${base}${p}`);
  const href = (p: string) => (p === "/" ? base : `${base}${p}`);

  // ── Persistent composer state (event-based bridge to AgentSessionView) ──
  const agent = agents.find((a) => a.id === agentId || a.name === agentId);
  const agentDisplayName = agent?.display_name || agent?.name || agentId || "";

  const [composerInput, setComposerInput] = useState("");
  const [composerStreaming, setComposerStreaming] = useState(false);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const composerFileRef = useRef<HTMLInputElement>(null);
  const [composerFiles, setComposerFiles] = useState<
    { name: string; content: string; size: number }[]
  >([]);
  const [composerPrompts, setComposerPrompts] = useState<string[]>([]);
  const [composerTask, setComposerTask] = useState<{ id: string; name: string } | null>(null);
  const [composerDragOver, setComposerDragOver] = useState(false);
  const composerDragCounter = useRef(0);

  const readComposerFiles = useCallback((files: FileList | File[]) => {
    Array.from(files).forEach((file) => {
      if (file.size > 512_000) return;
      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result as string;
        setComposerFiles((prev) => {
          if (prev.some((f) => f.name === file.name)) return prev;
          return [...prev, { name: file.name, content, size: file.size }];
        });
      };
      reader.readAsText(file);
    });
  }, []);

  const setPendingMessage = useChatStore((s) => s.setPendingMessage);

  const handleComposerSend = useCallback(() => {
    const text = composerInput.trim();
    if (!text) return;
    const detail = {
      text,
      files: composerFiles.length > 0 ? composerFiles : undefined,
      prompts: composerPrompts.length > 0 ? composerPrompts : undefined,
      task: composerTask || undefined,
    };
    if (agentId) {
      // A chat view is mounted — fire the event so AgentSessionView picks it up.
      window.dispatchEvent(new CustomEvent("aeqi:send-message", { detail }));
    } else {
      // No chat mounted — stash for the chat to consume on mount, then navigate.
      setPendingMessage(detail);
      navigate(`${base}/sessions`);
    }
    setComposerInput("");
    setComposerFiles([]);
    setComposerPrompts([]);
    setComposerTask(null);
    requestAnimationFrame(() => composerInputRef.current?.focus());
  }, [
    composerInput,
    composerFiles,
    composerPrompts,
    composerTask,
    agentId,
    setPendingMessage,
    navigate,
    base,
  ]);

  const handleComposerStop = useCallback(() => {
    window.dispatchEvent(new CustomEvent("aeqi:stop-streaming"));
  }, []);

  // Listen for streaming state from AgentSessionView
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setComposerStreaming(detail.streaming);
    };
    window.addEventListener("aeqi:streaming-state", handler);
    return () => window.removeEventListener("aeqi:streaming-state", handler);
  }, []);

  // Reset composer streaming when agent changes
  useEffect(() => {
    setComposerStreaming(false);
  }, [agentId]);

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
        <div className={`left-sidebar${sidebarCollapsed ? " collapsed" : ""}`}>
          {/* Sidebar header — brand + hamburger */}
          <div className="sidebar-header">
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
            <button
              className="sidebar-collapse-btn"
              onClick={toggleSidebar}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="1" y="2" width="14" height="12" rx="2" />
                <path d="M6 2v12" />
                {sidebarCollapsed ? (
                  <path d="M9.5 6.5L11.5 8L9.5 9.5" />
                ) : (
                  <path d="M11.5 6.5L9.5 8L11.5 9.5" />
                )}
              </svg>
            </button>
          </div>

          <nav className="sidebar-nav">
            <a
              className={`sidebar-nav-item ${isActive("/profile") ? "active" : ""}`}
              href={href("/profile")}
              onClick={(e) => {
                e.preventDefault();
                go("/profile");
              }}
            >
              <span className="sidebar-nav-avatar">
                <RoundAvatar name={userName} size={16} src={user?.avatar_url} />
              </span>
              <span className="sidebar-nav-label">{userName}</span>
            </a>
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
          {/* Scope indicator — only when drilled into a child agent */}
          {agentId && agentId !== rootId && (
            <div className="sidebar-agent-scope">
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
              <div className="sidebar-scope">
                <RoundAvatar
                  name={agents.find((a) => a.id === agentId || a.name === agentId)?.name || agentId}
                  size={18}
                />
                <span className="sidebar-scope-name">
                  {agents.find((a) => a.id === agentId || a.name === agentId)?.display_name ||
                    agents.find((a) => a.id === agentId || a.name === agentId)?.name ||
                    agentId}
                </span>
              </div>
            </div>
          )}
          <div className="left-sidebar-body">
            <AgentTree />
          </div>
        </div>

        {/* Main content */}
        <div className="content-column">
          <div className="content-card">
            <div className="content-main">
              {agentId ? (
                <AgentPage
                  agentId={agentId}
                  tab={isRootChat ? "sessions" : undefined}
                  itemId={isRootChat ? rootSessionItemId : undefined}
                />
              ) : (
                <>
                  <ContentTopBar />
                  <div className="content-scroll">
                    <Outlet />
                  </div>
                </>
              )}
            </div>
            <aside className="content-cta-col">
              <ContentCTA />
            </aside>
          </div>
          <div className="composer-row">
            <div className="composer-wrap">
              <div className="persistent-composer">
                <ChatComposer
                  input={composerInput}
                  setInput={setComposerInput}
                  streaming={composerStreaming}
                  displayName={agentDisplayName || "agent"}
                  sessionPrompts={composerPrompts}
                  setSessionPrompts={setComposerPrompts}
                  sessionTask={composerTask}
                  setSessionTask={setComposerTask}
                  attachedFiles={composerFiles}
                  setAttachedFiles={setComposerFiles}
                  setShowAttachPicker={() => {}}
                  readFiles={readComposerFiles}
                  dragOver={composerDragOver}
                  setDragOver={setComposerDragOver}
                  dragCounter={composerDragCounter}
                  onSend={handleComposerSend}
                  onStop={handleComposerStop}
                  inputRef={composerInputRef}
                  fileInputRef={composerFileRef}
                />
              </div>
            </div>
            <div className="composer-spacer" aria-hidden />
          </div>
        </div>
      </div>
      <CommandPalette open={searching} onClose={closeSearch} />
    </>
  );
}
