import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { Spinner } from "@/components/ui";
import AppLayout from "@/components/AppLayout";

// Auth pages -- loaded eagerly since they gate entry
import LoginPage from "@/pages/LoginPage";
import SignupPage from "@/pages/SignupPage";
import VerifyEmailPage from "@/pages/VerifyEmailPage";
import AuthCallbackPage from "@/pages/AuthCallbackPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";

// App pages -- lazy-loaded for route-level code splitting
const NewAgentPage = lazy(() => import("@/pages/NewAgentPage"));
const AgentsPage = lazy(() => import("@/pages/AgentsPage"));
const ChangePasswordPage = lazy(() => import("@/pages/ChangePasswordPage"));

const LoadingSpinner = () => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      minHeight: "100vh",
      color: "var(--text-muted)",
      fontSize: 13,
    }}
  >
    <Spinner size="sm" />
    Loading…
  </div>
);

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const authMode = useAuthStore((s) => s.authMode);
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const fetchAuthMode = useAuthStore((s) => s.fetchAuthMode);
  const fetchMe = useAuthStore((s) => s.fetchMe);

  useEffect(() => {
    fetchAuthMode();
  }, [fetchAuthMode]);

  // On a fresh page load we hydrate the token from localStorage but have
  // no user object yet — sidebar, profile, and anywhere else that keys
  // off `user.name`/`user.email` falls back to "You". Pull the profile
  // once per session when we're authenticated against a real account.
  useEffect(() => {
    if (authMode && authMode !== "none" && token && !user) fetchMe();
  }, [authMode, token, user, fetchMe]);

  if (!authMode) return <LoadingSpinner />;
  if (authMode === "none") return <>{children}</>;
  if (!token) {
    const here = location.pathname + location.search;
    const dest = here === "/" ? "/login" : `/login?next=${encodeURIComponent(here)}`;
    return <Navigate to={dest} replace />;
  }
  return <>{children}</>;
}

/**
 * Wrapper for `/blueprints` and `/economy`. Authed visitors hit the full
 * AppLayout, which dispatches the matching page from the URL. Unauthed
 * visitors bounce to /login — the public-marketing variants of these
 * surfaces are paused until they're production-ready; PublicLayout
 * stays in the tree for when we revive them.
 */
function GatedAppShell() {
  const location = useLocation();
  const authMode = useAuthStore((s) => s.authMode);
  const token = useAuthStore((s) => s.token);
  const fetchAuthMode = useAuthStore((s) => s.fetchAuthMode);

  useEffect(() => {
    fetchAuthMode();
  }, [fetchAuthMode]);

  if (!authMode) return <LoadingSpinner />;
  if (authMode === "none" || token) return <AppLayout />;
  const here = location.pathname + location.search;
  return <Navigate to={`/login?next=${encodeURIComponent(here)}`} replace />;
}

// `/` always lands on the user-scoped home dashboard. We used to auto-bounce
// to the last-visited company via localStorage; that made it impossible to
// actually see the home view once a root was in scope, so the bounce is gone.
// The sidebar still carries the company switcher.

/**
 * Version B — flat URL architecture. Every agent (root or child) lives at
 * `/:agentId/...`. There is no `/agents/` URL segment. AppLayout inspects the
 * current agent's `parent_id` to decide root-only rendering (billing, apps,
 * drive), but the URL shape is identical regardless of where the agent sits
 * in the tree. Profile lives at `/profile` (top-level, user-scoped) so it
 * never dead-ends when no root is active; it still inherits the shell.
 */
export default function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<LoadingSpinner />}>
        <Routes>
          {/* Public auth routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/waitlist" element={<Navigate to="/signup" replace />} />
          <Route path="/verify" element={<VerifyEmailPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          {/* Blueprints and Economy — currently auth-gated end-to-end.
              GatedAppShell dispatches AppLayout for authed visitors and
              redirects everyone else to /login?next=<here>. Will revert
              to a public-marketing variant once those surfaces ship. */}
          <Route path="/blueprints" element={<GatedAppShell />} />
          <Route path="/blueprints/companies" element={<GatedAppShell />} />
          <Route path="/blueprints/agents" element={<GatedAppShell />} />
          <Route path="/blueprints/events" element={<GatedAppShell />} />
          <Route path="/blueprints/quests" element={<GatedAppShell />} />
          <Route path="/blueprints/ideas" element={<GatedAppShell />} />
          <Route path="/blueprints/:slug" element={<GatedAppShell />} />
          <Route path="/blueprints/:slug/:section" element={<GatedAppShell />} />
          <Route path="/economy" element={<GatedAppShell />} />
          <Route path="/library" element={<Navigate to="/blueprints" replace />} />
          <Route path="/protocol" element={<Navigate to="/economy" replace />} />
          <Route path="/templates" element={<Navigate to="/blueprints" replace />} />

          {/* Protected routes */}
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <Routes>
                  {/* Standalone full-page routes — wizard-style surfaces
                      that intentionally do NOT inherit the shell. */}
                  <Route path="agents" element={<AgentsPage />} />
                  <Route path="change-password" element={<ChangePasswordPage />} />

                  {/* /new is now sub-agent-only (`/new?parent=:id`). The
                      no-parent variant (root creation) self-redirects
                      to /start from inside NewAgentPage. */}
                  <Route path="new" element={<NewAgentPage />} />

                  {/* Home dashboard + profile + every agent at
                      /:agentId/... share the same shell — AppLayout
                      decides content from path + params. /blueprints
                      and /economy are routed publicly above and never
                      enter the protected branch. User-scoped routes
                      are registered before :agentId so react-router
                      prefers the literal match. */}
                  <Route element={<AppLayout />}>
                    <Route index element={null} />
                    <Route path="account" element={null} />
                    <Route path="account/:tab" element={null} />
                    {/* /start renders inside the shell — Company
                        creation is part of the app, not a separate
                        wizard. AppLayout dispatches StartPage when
                        path === "/start". */}
                    <Route path="start" element={null} />
                    {/* User-scope inbox session viewer: opens a single
                        awaiting session inline at user scope, with the
                        sessions rail showing all pending items across
                        every agent the user has access to. The agent_id
                        is resolved from the inbox item by session_id,
                        not from the URL. */}
                    <Route path="sessions/:sessionId" element={null} />
                    <Route path=":agentId" element={null}>
                      <Route index element={null} />
                      <Route path=":tab" element={null} />
                      <Route path=":tab/:itemId" element={null} />
                    </Route>
                  </Route>
                </Routes>
              </ProtectedRoute>
            }
          />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
