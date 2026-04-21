import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
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
const EntitiesPage = lazy(() => import("@/pages/EntitiesPage"));
const TemplatesPage = lazy(() => import("@/pages/TemplatesPage"));

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
  const authMode = useAuthStore((s) => s.authMode);
  const token = useAuthStore((s) => s.token);
  const fetchAuthMode = useAuthStore((s) => s.fetchAuthMode);

  useEffect(() => {
    fetchAuthMode();
  }, [fetchAuthMode]);

  if (!authMode) return <LoadingSpinner />;
  if (authMode === "none") return <>{children}</>;
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
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
 * in the tree. Profile lives at `/:agentId/profile` so it inherits the shell
 * (Refined A) — the agent context is ambient; the page content is user-level.
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

          {/* Protected routes */}
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <Routes>
                  {/* User-level routes */}
                  <Route path="new" element={<NewAgentPage />} />
                  <Route path="templates" element={<TemplatesPage />} />
                  <Route path="agents" element={<EntitiesPage />} />

                  {/* Home dashboard + every agent at /:agentId/... share the
                      same shell — AppLayout renders the user-scoped home when
                      agentId is absent. */}
                  <Route element={<AppLayout />}>
                    <Route index element={null} />
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
