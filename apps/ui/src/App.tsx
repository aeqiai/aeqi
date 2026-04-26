import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { Spinner } from "@/components/ui";
import AppLayout from "@/components/AppLayout";
import PublicLayout from "@/components/PublicLayout";

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
const BlueprintsPage = lazy(() => import("@/pages/BlueprintsPage"));
const BlueprintDetailPage = lazy(() => import("@/pages/BlueprintDetailPage"));
const EconomyPage = lazy(() => import("@/pages/EconomyPage"));

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
 * Wrapper for the two public-app surfaces (`/blueprints`, `/economy`).
 * Authed visitors see the full AppLayout dispatch (the page renders
 * inside the agent shell, with the rail's nav items already pointing
 * here). Unauthed visitors see PublicLayout — same shell silhouette,
 * brand wordmark in the corner, only Blueprints/Economy on the rail,
 * Sign up / Log in CTAs pinned below.
 */
function PublicOrAppShell({ publicPage }: { publicPage: React.ReactNode }) {
  const authMode = useAuthStore((s) => s.authMode);
  const token = useAuthStore((s) => s.token);
  const fetchAuthMode = useAuthStore((s) => s.fetchAuthMode);

  useEffect(() => {
    fetchAuthMode();
  }, [fetchAuthMode]);

  if (!authMode) return <LoadingSpinner />;
  // Authed (or no-auth daemon) — defer to the full shell, which
  // dispatches BlueprintsPage / EconomyPage from the URL itself.
  if (authMode === "none" || token) return <AppLayout />;
  return <PublicLayout>{publicPage}</PublicLayout>;
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

          {/* Public app surfaces — Blueprints (the runtime catalog) and
              Economy (coming-soon skeleton). Both are reachable without
              auth via PublicLayout; authed visitors fall through to
              AppLayout, which dispatches the same pages inside the
              full shell. */}
          <Route
            path="/blueprints"
            element={<PublicOrAppShell publicPage={<BlueprintsPage />} />}
          />
          <Route
            path="/blueprints/:slug"
            element={<PublicOrAppShell publicPage={<BlueprintDetailPage />} />}
          />
          <Route path="/economy" element={<PublicOrAppShell publicPage={<EconomyPage />} />} />
          {/* Legacy public-surface aliases — kept here so unauthed
              visitors don't bounce through the protected shell. */}
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
                  <Route path="new" element={<NewAgentPage />} />
                  <Route path="agents" element={<AgentsPage />} />
                  <Route path="change-password" element={<ChangePasswordPage />} />

                  {/* Home dashboard + profile + every agent at
                      /:agentId/... share the same shell — AppLayout
                      decides content from path + params. /blueprints
                      and /economy are routed publicly above and never
                      enter the protected branch. User-scoped routes
                      are registered before :agentId so react-router
                      prefers the literal match. */}
                  <Route element={<AppLayout />}>
                    <Route index element={null} />
                    <Route path="settings" element={null} />
                    {/* User-scope inbox session viewer: opens a single
                        awaiting session inline at user scope, with the
                        sessions rail showing all pending items across
                        every agent the user has access to. The agent_id
                        is resolved from the inbox item by session_id,
                        not from the URL. */}
                    <Route path="sessions/:sessionId" element={null} />
                    {/* /profile is a per-user alias for /settings; old
                        links / bookmarks don't dead-end. */}
                    <Route path="profile" element={<Navigate to="/settings" replace />} />
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
