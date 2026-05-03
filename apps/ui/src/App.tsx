import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { Spinner } from "@/components/ui";
import AppLayout from "@/components/AppLayout";
import SessionRedirect from "@/components/SessionRedirect";

// Auth pages -- loaded eagerly since they gate entry
import LoginPage from "@/pages/LoginPage";
import SignupPage from "@/pages/SignupPage";
import VerifyEmailPage from "@/pages/VerifyEmailPage";
import AuthCallbackPage from "@/pages/AuthCallbackPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import MagicLinkPage from "@/pages/MagicLinkPage";

// App pages -- lazy-loaded for route-level code splitting
const AgentsPage = lazy(() => import("@/pages/AgentsPage"));
const ChangePasswordPage = lazy(() => import("@/pages/ChangePasswordPage"));
const DiscoverPage = lazy(() => import("@/pages/DiscoverPage"));

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
 * Wrapper for `/economy` and `/blueprints` — both top-level destinations
 * that mount the app shell. Authed visitors hit the full AppLayout,
 * which dispatches the matching page from the URL. Unauthed visitors
 * bounce to /login — the public-marketing variants of these surfaces
 * are paused until they're production-ready; PublicLayout stays in the
 * tree for when we revive them.
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
 * lives at `/me` (top-level, user-scoped) so it never dead-ends when
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
          <Route path="/auth/magic" element={<MagicLinkPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          {/* Public Discover — the Economy front door at `/`. No auth
              required; signed-in users hit it the same as visitors. The
              previous shell-rendered Inbox at `/` shifted to
              `/c/:entityId/inbox` (Phase-1 sidebar lock). */}
          <Route path="/" element={<DiscoverPage />} />

          {/* Economy + Blueprints — both top-level destinations,
              currently auth-gated end-to-end. GatedAppShell dispatches
              AppLayout for authed visitors and redirects everyone else
              to /login?next=<here>. Will revert to a public-marketing
              variant once those surfaces ship. */}
          <Route path="/economy" element={<GatedAppShell />} />
          <Route path="/blueprints" element={<GatedAppShell />} />
          <Route path="/blueprints/companies" element={<GatedAppShell />} />
          <Route path="/blueprints/agents" element={<GatedAppShell />} />
          <Route path="/blueprints/events" element={<GatedAppShell />} />
          <Route path="/blueprints/quests" element={<GatedAppShell />} />
          <Route path="/blueprints/ideas" element={<GatedAppShell />} />
          <Route path="/blueprints/:slug" element={<GatedAppShell />} />
          <Route path="/blueprints/:slug/:section" element={<GatedAppShell />} />

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

                  {/* Legacy flat session URL — resolves the owning
                      agent + entity (inbox store fast path, then
                      getSessions recovery), then Navigate replace to
                      the canonical deep shape. Lives outside the
                      shell: the redirect renders before any chrome
                      mounts, so the user never sees the old URL
                      decorated with composer / rail wiring. */}
                  <Route path="sessions/:sessionId" element={<SessionRedirect />} />

                  {/* Home dashboard + profile + every company at
                      /c/:entityId/... share the same shell — AppLayout
                      decides content from path + params. /economy and
                      /blueprints are routed publicly above and never
                      enter the protected branch. User-scoped routes
                      are registered before the legacy redirect so
                      react-router prefers the literal match. */}
                  <Route element={<AppLayout />}>
                    {/* `/` is registered publicly above as DiscoverPage;
                        no index route here. */}
                    <Route path="me" element={null} />
                    <Route path="me/:tab" element={null} />
                    {/* Admin dashboard — gated server-side on is_admin and
                        client-side via redirect in AdminPage itself. */}
                    <Route path="admin" element={null} />
                    {/* /start renders inside the shell — Company
                        creation is part of the app, not a separate
                        wizard. AppLayout dispatches StartPage when
                        path === "/start". */}
                    <Route path="start" element={null} />
                    <Route path="start/:slug" element={null} />
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
                    {/* Catch-all 404 inside the protected shell. Lives
                        last so every other matcher above wins first. */}
                    <Route path="*" element={null} />
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
