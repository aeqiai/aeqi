import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import CommandPalette from "./CommandPalette";
import AgentPage from "./AgentPage";
import LeftSidebar from "./shell/LeftSidebar";
import ShellFooter from "./shell/ShellFooter";
import SessionsRail from "./shell/SessionsRail";
import ComposerRow from "./shell/ComposerRow";
import BootLoader from "./shell/BootLoader";
import ShortcutsOverlay from "./ShortcutsOverlay";
import { useDaemonStore } from "@/store/daemon";
import { useInboxStore } from "@/store/inbox";
import { useUIStore } from "@/store/ui";
import { useAuthStore } from "@/store/auth";
import { useDaemonSocket } from "@/hooks/useDaemonSocket";
import { isRateLimited } from "@/lib/rateLimit";
import RateLimitBanner from "./shell/RateLimitBanner";
import type { Agent } from "@/lib/types";

// Out-of-flow pages rendered inside the shell — lazy to keep AppLayout light.
// Drive is root-only. Profile is user-scoped and lives at top-level `/profile`
// (never namespaced under an agent) — it inherits the sidebar + tree chrome.
const DrivePage = lazy(() => import("@/pages/DrivePage"));
const ProfilePage = lazy(() => import("@/pages/ProfilePage"));
const BlueprintsPage = lazy(() => import("@/pages/BlueprintsPage"));
const EconomyPage = lazy(() => import("@/pages/EconomyPage"));
// HomeDashboard is the `/` landing — user-scoped summary across every
// company the user has.
const HomeDashboard = lazy(() => import("./HomeDashboard"));
const UserInboxSessionView = lazy(() => import("./inbox/UserInboxSessionView"));

/** Walk up parent_id to find the root ancestor. */
function findRoot(agents: Agent[], id: string): Agent | null {
  const byId = new Map<string, Agent>(agents.map((a) => [a.id, a]));
  let current = byId.get(id);
  for (let i = 0; i < 20 && current; i++) {
    if (!current.parent_id) return current;
    current = byId.get(current.parent_id);
  }
  return current || null;
}

/**
 * Top-level shell: sidebar, content card, persistent composer. (The old
 * right rail was removed — each tab now renders its own inline picker.)
 *
 * Version B: routes are flat — `/:agentId/[:tab/[:itemId]]`. This component
 * parses those params, resolves the target agent, derives the tree's root
 * from the parent chain, and routes to the right tab renderer. No more
 * `/agents/` URL segment, no regex URL sniffing.
 */
export default function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
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
  const setActiveRoot = useUIStore((s) => s.setActiveRoot);
  const activeRoot = useUIStore((s) => s.activeRoot);

  // userSessionId derivation lifted up here so the inbox-store hook
  // below can sit alongside every other hook at the top of the
  // component — keeps eslint react-hooks/rules-of-hooks happy.
  const _userSessionMatch = location.pathname.match(/^\/sessions\/([^/]+)\/?$/);
  const _userSessionId = _userSessionMatch ? decodeURIComponent(_userSessionMatch[1]) : null;
  const inboxAgentId = useInboxStore((s) =>
    _userSessionId
      ? (s.items.find((i) => i.session_id === _userSessionId)?.agent_id ?? null)
      : null,
  );

  // Resolve current agent + derive the root of its tree.
  const { currentAgent, rootAgent } = useMemo(() => {
    const current = agents.find((a) => a.id === agentId || a.name === agentId) || null;
    const root = current ? findRoot(agents, current.id) : null;
    return {
      currentAgent: current,
      rootAgent: root,
    };
  }, [agents, agentId]);

  // Fallback root for context-less routes (/, /profile, /drive) so the sidebar
  // surface-nav + tree expansion render the same everywhere. Prefer:
  //   current agent's root → last-visited root (if it still exists) → first root.
  // We deliberately do NOT fall back to the raw `agentId` from the URL — if
  // it doesn't resolve to a real agent we've already redirected home above,
  // and we never want to cache a non-agent segment (e.g. "profile") as the
  // active root.
  const firstRoot = useMemo(() => agents.find((a) => !a.parent_id)?.id || null, [agents]);
  const activeRootValid = useMemo(
    () => (activeRoot && agents.some((a) => a.id === activeRoot) ? activeRoot : null),
    [agents, activeRoot],
  );
  const rootId = rootAgent?.id || activeRootValid || firstRoot || "";

  // Sync the active root scope into the UI store (used by /profile etc.).
  // Only commit once we have a verified-real root, otherwise the initial
  // pre-load render can persist a bogus value into localStorage.
  useEffect(() => {
    if (rootId && agents.some((a) => a.id === rootId)) setActiveRoot(rootId);
  }, [rootId, agents, setActiveRoot]);

  // Browser tab title — echoes the current primitive + agent so multi-tab
  // power users can scan their window strip. Format mirrors the in-app
  // breadcrumb: "<section> — <agent> · æqi". Bare "æqi" before an agent
  // resolves.
  useEffect(() => {
    const titles: Record<string, string> = {
      sessions: "home",
      channels: "Channels",
      drive: "Drive",
      settings: "Settings",
      tools: "Tools",
      profile: "Profile",
      agents: "agents",
      events: "events",
      quests: "quests",
      ideas: "ideas",
    };
    const section = tab || "sessions";
    const sectionTitle = titles[section] || section;
    const agentLabel = currentAgent?.name;
    document.title = agentLabel ? `${sectionTitle} — ${agentLabel} · æqi` : "æqi";
  }, [tab, currentAgent]);

  // Daemon bootstrap + live updates.  We pause the periodic refresh while
  // the central 429 state says we're rate-limited — polling while blocked
  // just piles on more 429s and extends the window the user is stuck.
  const fetchAll = useDaemonStore((s) => s.fetchAll);
  useEffect(() => {
    fetchAll();
    const i = setInterval(() => {
      if (isRateLimited()) return;
      fetchAll();
    }, 30000);
    return () => clearInterval(i);
  }, [fetchAll, rootId]);
  useDaemonSocket();

  // Global keyboard shortcuts:
  //   ⌘K / Ctrl+K — command palette
  //   /           — command palette (vim-style)
  //   ⌘B / Ctrl+B — toggle sidebar (VS Code convention)
  //   ?           — shortcuts cheatsheet
  //   Esc         — close palette / overlay
  //   N           — spawn a sub-agent under the current agent
  //   C           — focus the composer (write mode without a mouse)
  //   g then a/e/q/i/s — jump to Agents / Events / Quests / Ideas / inbox
  //                      for the current agent (vim-style go-to prefix;
  //                      letters match the sidebar's A-E-Q-I wordmark).
  //                      Skip when typing in an input/textarea, or when
  //                      modifiers are held, so real text entry is never
  //                      hijacked.
  const openSearch = useCallback(() => setSearching(true), []);
  const closeSearch = useCallback(() => setSearching(false), []);
  // Vim-style two-key prefix. When the user taps `g`, we set a deadline ~1.5s
  // ahead; the next letter during that window is treated as the navigation
  // target instead of whatever shortcut it would otherwise trigger. A ref
  // keeps the deadline stable across renders without re-binding the handler.
  const gDeadlineRef = useRef<number>(0);
  // The top-bar "Search" button dispatches `aeqi:open-palette` so callers
  // don't need AppLayout-scoped state threaded down — same pattern as the
  // per-tab `+ New X` buttons inside each inline picker.
  useEffect(() => {
    window.addEventListener("aeqi:open-palette", openSearch);
    return () => window.removeEventListener("aeqi:open-palette", openSearch);
  }, [openSearch]);
  // UI-triggered shortcuts overlay — lets the topbar `?` button open the
  // cheatsheet without prop-drilling the setter.
  useEffect(() => {
    const open = () => setShortcutsOpen(true);
    window.addEventListener("aeqi:open-shortcuts", open);
    return () => window.removeEventListener("aeqi:open-shortcuts", open);
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (searching) closeSearch();
        else openSearch();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        useUIStore.getState().toggleSidebar();
        return;
      }
      if (e.key === "Escape") {
        if (searching) closeSearch();
        if (shortcutsOpen) setShortcutsOpen(false);
        return;
      }
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isEditable = tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable;
      // Palette + cheatsheet both own the keyboard while open — don't let
      // `n` / `c` / g-prefix navigate the user out from under an overlay.
      if (isEditable || searching || shortcutsOpen) return;
      // Vim go-to prefix: if the previous key was `g` within the window,
      // this key is the target. Consume + navigate, return before any other
      // shortcut gets a chance. s→inbox, a→agents, e→events, q→quests,
      // i→ideas. Runs even when agentId is absent (no-op on empty scope).
      if (gDeadlineRef.current > Date.now() && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const key = e.key.toLowerCase();
        const tabs: Record<string, string> = {
          s: "",
          a: "agents",
          e: "events",
          q: "quests",
          i: "ideas",
        };
        if (key in tabs && agentId) {
          e.preventDefault();
          gDeadlineRef.current = 0;
          const seg = tabs[key];
          const base = `/${encodeURIComponent(agentId)}`;
          navigate(seg ? `${base}/${seg}` : base);
          return;
        }
        // Any other key cancels the prefix so the next tap is normal.
        gDeadlineRef.current = 0;
      }
      if (e.key.toLowerCase() === "g" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        gDeadlineRef.current = Date.now() + 1500;
        return;
      }
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setShortcutsOpen((s) => !s);
        return;
      }
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        openSearch();
        return;
      }
      if (e.key.toLowerCase() === "n" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        navigate(agentId ? `/new?parent=${encodeURIComponent(agentId)}` : "/new");
        return;
      }
      if (e.key.toLowerCase() === "c" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("aeqi:focus-composer"));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [searching, shortcutsOpen, openSearch, closeSearch, agentId, navigate]);

  const initialLoaded = useDaemonStore((s) => s.initialLoaded);
  const appMode = useAuthStore((s) => s.appMode);

  // userSessionId derived above (next to the inbox-store hook) for
  // hook-ordering reasons; aliased here so the rest of this scope
  // reads naturally.
  const userSessionId = _userSessionId;

  if (!initialLoaded) return <BootLoader />;

  // URL points at an agent that no longer exists (e.g., after a data reset
  // the stale `aeqi_root` localStorage still referenced it). Drop the stale
  // pointer and bounce home — never to /new directly, which can create a
  // self-sustaining loop when a placement exists without a matching runtime
  // agent.
  if (agentId && !currentAgent) {
    localStorage.removeItem("aeqi_root");
    return <Navigate to="/" replace />;
  }

  // `/profile` — user-scoped profile. No agent in scope; the page is about
  // the user, not a company. Matched via path because the route has no
  // :agentId param (it's a top-level sibling of `/` and `/:agentId`).
  // `/settings` is the user-scoped settings surface (formerly /profile).
  // Legacy /profile URLs redirect there in App.tsx; we also match
  // `tab === "profile"` defensively for any stale in-memory links.
  const isSettings = path === "/settings" || path === "/profile" || tab === "profile";
  // User-scoped surfaces that share the shell but render their own page
  // content. Detected from path so they don't get caught by the agentId
  // matcher and so isHome can exclude them cleanly.
  const isBlueprints = path === "/blueprints" || path.startsWith("/blueprints/");
  const isEconomy = path === "/economy" || path.startsWith("/economy/");
  // `/sessions/:sessionId` — user-scope inbox session view. Same shell
  // as the agent-scope sessions surface, but the rail shows inbox items
  // (across every agent the user can see) and the agent_id is resolved
  // from the inbox item. (userSessionId derived above; declared early
  // so the inbox-agent hook can be called without violating
  // rules-of-hooks.)
  const isUserSession = !!userSessionId;
  // `/` — user-scoped landing. Doubles as the Inbox surface root: the
  // sessions rail surfaces awaiting items, the main column carries
  // greeting + caught-up status. Composer is hidden here — there's no
  // session to be texting to until the user picks one from the rail.
  const isHome = !agentId && !isSettings && !isBlueprints && !isEconomy && !isUserSession;

  const base = agentId ? `/${encodeURIComponent(agentId)}` : "/";

  // Pick what renders in the main content area.
  //   - profile                        → user profile (any scope)
  //   - home (no agent, not profile)   → HomeDashboard (welcome + summary)
  //   - drive                          → dedicated page (available on every agent)
  //   - no tab                         → Inbox (agent landing — same as tab="sessions")
  //   - everything else                → AgentPage with tab/itemId
  const isDrive = tab === "drive";
  // Inbox is the default surface. No-tab URLs are treated identically to
  // tab="sessions" so /:agentId renders the Inbox directly — no redirect,
  // no per-agent welcome splash.
  const effectiveTab = tab || "sessions";

  // User settings are platform-mode only — runtime mode has nowhere to
  // manage account-level identity, so kick back to `/`.
  if (isSettings && appMode && appMode !== "platform") {
    return <Navigate to="/" replace />;
  }

  // Canonicalize the per-agent sessions URL: `/:agentId/sessions` (no
  // session picked) renders the same surface as bare `/:agentId`, so
  // collapse it. Keep `/:agentId/sessions/:sessionId` intact — the
  // itemId is real state.
  if (agentId && tab === "sessions" && !itemId) {
    return <Navigate to={`/${encodeURIComponent(agentId)}`} replace />;
  }

  const mainContent = (() => {
    if (isUserSession && userSessionId) return <UserInboxSessionView sessionId={userSessionId} />;
    if (isHome) return <HomeDashboard />;
    if (isDrive) return <DrivePage />;
    if (isSettings) return <ProfilePage />;
    if (isBlueprints) return <BlueprintsPage />;
    if (isEconomy) return <EconomyPage />;
    return <AgentPage agentId={agentId} tab={effectiveTab} itemId={itemId} />;
  })();

  // AgentSessionView mounts on the per-agent sessions surface and on the
  // user-scope inbox session view. Both want the persistent composer +
  // streaming-state event bridge; the user-scope variant just resolves
  // its agent from the inbox row instead of from the URL.
  const sessionsMounted =
    isUserSession ||
    (!isDrive &&
      !isSettings &&
      !isHome &&
      !isBlueprints &&
      !isEconomy &&
      effectiveTab === "sessions");
  // Composer lives with the sessions surface. At user scope, hide it
  // when no session is selected — there's nothing to be texting to.
  const showComposer = sessionsMounted;
  // Sessions rail variants:
  //   - inbox mode: at /, /sessions/:id (and only at user scope) — list
  //     of awaiting items across every agent.
  //   - agent mode: at /:agentId/sessions[/...] — that agent's session list.
  // Other tabs render their own inline picker inside the content column
  // and own their full width.
  const inboxRail = (isHome || isUserSession) && !isSettings && !isBlueprints && !isEconomy;
  const agentRail = effectiveTab === "sessions" && !!agentId && !isSettings && !isDrive && !isHome;
  const showSessionsRail = inboxRail || agentRail;
  const railMode: "inbox" | "agent" = inboxRail ? "inbox" : "agent";

  return (
    <>
      <div className="shell">
        <LeftSidebar agentId={agentId} path={path} />

        <div className="content-column">
          <div className="content-card">
            {/* ContentTopBar dropped — after moving Settings to the
                LeftSidebar the band held only an avatar in user scope
                and a budget meter in agent scope, both better-placed
                inside the page that owns them. The empty strip read
                as a gap above every page. Page content now renders
                flush against the content card's top edge. */}
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
          <ShellFooter />
        </div>
      </div>
      <CommandPalette open={searching} onClose={closeSearch} />
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </>
  );
}
