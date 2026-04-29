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
 * Wrapper for `/economy` (including its `/economy/blueprints` sub-rail).
 * Authed visitors hit the full AppLayout, which dispatches the matching
 * page from the URL. Unauthed visitors bounce to /login — the
 * public-marketing variants of these surfaces are paused until they're
 * production-ready; PublicLayout stays in the tree for when we revive
 * them.
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

// `/` is only the user-scope landing before an entity exists. Once an entity
// exists, AppLayout canonicalizes the shell to `/c/:entityId` so sidebar tabs
// never generate bogus top-level paths like `/quests`.

/**
 * Version C — entity-root URL architecture. The app shell lives at
 * `/c/:entityId/...`; the sidebar always navigates inside that entity. Child
 * agents remain addressable at `/c/:entityId/agents/:agentId/...`. Profile
 * lives at `/account` (top-level, user-scoped) so it never dead-ends when
 * no root is active; it still inherits the shell.
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

          {/* Economy and its Blueprints sub-rail — currently auth-gated
              end-to-end. GatedAppShell dispatches AppLayout for authed
              visitors and redirects everyone else to /login?next=<here>.
              Will revert to a public-marketing variant once those
              surfaces ship. */}
          <Route path="/economy" element={<GatedAppShell />} />
          <Route path="/economy/blueprints" element={<GatedAppShell />} />
          <Route path="/economy/blueprints/companies" element={<GatedAppShell />} />
          <Route path="/economy/blueprints/agents" element={<GatedAppShell />} />
          <Route path="/economy/blueprints/events" element={<GatedAppShell />} />
          <Route path="/economy/blueprints/quests" element={<GatedAppShell />} />
          <Route path="/economy/blueprints/ideas" element={<GatedAppShell />} />
          <Route path="/economy/blueprints/:slug" element={<GatedAppShell />} />
          <Route path="/economy/blueprints/:slug/:section" element={<GatedAppShell />} />

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

                  {/* Home dashboard + profile + every company at
                      /c/:entityId/... share the same shell — AppLayout
                      decides content from path + params. /economy
                      (and its /economy/blueprints sub-rail) is routed
                      publicly above and never enters the protected
                      branch. User-scoped routes are registered before
                      the legacy redirect so react-router prefers the
                      literal match. */}
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
                    {/* Canonical company route group. */}
                    <Route path="c/:entityId" element={null}>
                      <Route index element={null} />
                      <Route path="agents/:agentId" element={null}>
                        <Route index element={null} />
                        <Route path=":tab" element={null} />
                        <Route path=":tab/:itemId" element={null} />
                      </Route>
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
