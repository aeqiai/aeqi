import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, Navigate, useParams } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import AppLayout from "@/components/AppLayout";

// Auth pages -- loaded eagerly since they gate entry
import LoginPage from "@/pages/LoginPage";
import SignupPage from "@/pages/SignupPage";
import VerifyEmailPage from "@/pages/VerifyEmailPage";
import AuthCallbackPage from "@/pages/AuthCallbackPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";

// App pages -- lazy-loaded for route-level code splitting
const WelcomePage = lazy(() => import("@/pages/WelcomePage"));
const RuntimeHomePage = lazy(() => import("@/pages/RuntimeHomePage"));
const NewAgentPage = lazy(() => import("@/pages/NewAgentPage"));
const AgentsPage = lazy(() => import("@/pages/AgentsPage"));
const EventsPage = lazy(() => import("@/pages/EventsPage"));
const QuestsPage = lazy(() => import("@/pages/QuestsPage"));
const IdeasPage = lazy(() => import("@/pages/IdeasPage"));
const EntitiesPage = lazy(() => import("@/pages/EntitiesPage"));
const ProfilePage = lazy(() => import("@/pages/ProfilePage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));

const LoadingSpinner = () => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "100vh",
    }}
  >
    <div style={{ color: "rgba(0,0,0,0.3)", fontSize: 13 }}>Loading...</div>
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

function RootRedirect() {
  const activeRoot = localStorage.getItem("aeqi_root");
  // Only redirect if the saved root looks like a UUID (not an old name)
  if (activeRoot && activeRoot.includes("-") && activeRoot.length > 30) {
    return <Navigate to={`/${encodeURIComponent(activeRoot)}`} replace />;
  }
  // Clear stale non-UUID values
  if (activeRoot) {
    localStorage.removeItem("aeqi_root");
  }
  return <EntitiesPage />;
}

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
                  {/* Root: agent selector or redirect to active root */}
                  <Route index element={<RootRedirect />} />
                  <Route path="new" element={<NewAgentPage />} />

                  {/* Root-scoped routes: /:root/... */}
                  <Route path=":root" element={<AppLayout />}>
                    <Route index element={<ModeAwareHome />} />
                    <Route path="agents" element={<AgentsPage />} />
                    <Route path="agents/:agentId" element={<AgentsPage />} />
                    <Route path="agents/:agentId/:tab" element={<AgentsPage />} />
                    <Route path="agents/:agentId/:tab/:itemId" element={<AgentsPage />} />
                    <Route path="sessions" element={<RootSessionsRedirect />} />
                    <Route path="events" element={<EventsPage />} />
                    <Route path="quests" element={<QuestsPage />} />
                    <Route path="ideas" element={<IdeasPage />} />
                    <Route path="settings" element={<SettingsPage />} />
                    <Route path="profile" element={<ModeAwareProfileRoute />} />
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

function ModeAwareHome() {
  const appMode = useAuthStore((s) => s.appMode);
  return appMode === "platform" ? <WelcomePage /> : <RuntimeHomePage />;
}

function ModeAwareProfileRoute() {
  const appMode = useAuthStore((s) => s.appMode);
  return appMode === "platform" ? <ProfilePage /> : <Navigate to="/" replace />;
}

// `/:root/sessions` opens the root agent's chat — same view as a child agent's chat.
function RootSessionsRedirect() {
  const { root } = useParams<{ root: string }>();
  return <Navigate to={`/${root}/agents/${root}/sessions`} replace />;
}
