import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
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
const NewCompanyPage = lazy(() => import("@/pages/NewCompanyPage"));
const AgentsPage = lazy(() => import("@/pages/AgentsPage"));
const EventsPage = lazy(() => import("@/pages/EventsPage"));
const QuestsPage = lazy(() => import("@/pages/QuestsPage"));
const IdeasPage = lazy(() => import("@/pages/IdeasPage"));
const EntitiesPage = lazy(() => import("@/pages/EntitiesPage"));
const AccountPage = lazy(() => import("@/pages/AccountPage"));
const CompanyPage = lazy(() => import("@/pages/CompanyPage"));
const TreasuryPage = lazy(() => import("@/pages/TreasuryPage"));
const DrivePage = lazy(() => import("@/pages/DrivePage"));
const AppsPage = lazy(() => import("@/pages/AppsPage"));
const MarketPage = lazy(() => import("@/pages/MarketPage"));
const SessionsPage = lazy(() => import("@/pages/SessionsPage"));

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

function CompanyRedirect() {
  const activeCompany = localStorage.getItem("aeqi_company");
  if (activeCompany) {
    return <Navigate to={`/${encodeURIComponent(activeCompany)}`} replace />;
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
                  {/* Root: company selector or redirect to active company */}
                  <Route index element={<CompanyRedirect />} />
                  <Route path="new" element={<NewCompanyPage />} />

                  {/* Legacy flat routes → redirect to company-scoped */}
                  <Route path="agents" element={<CompanyRedirect />} />
                  <Route path="quests" element={<CompanyRedirect />} />
                  <Route path="events" element={<CompanyRedirect />} />
                  <Route path="ideas" element={<CompanyRedirect />} />
                  <Route path="sessions" element={<CompanyRedirect />} />
                  <Route path="companies" element={<CompanyRedirect />} />
                  <Route path="company" element={<CompanyRedirect />} />
                  <Route path="workspace" element={<CompanyRedirect />} />
                  <Route path="settings" element={<ModeAwareSettingsRedirect />} />

                  {/* Company-scoped routes: /:company/... */}
                  <Route path=":company" element={<AppLayout />}>
                    <Route index element={<ModeAwareHome />} />
                    <Route path="agents" element={<AgentsPage />} />
                    <Route path="agents/:agentId" element={<AgentsPage />} />
                    <Route path="agents/:agentId/:tab" element={<AgentsPage />} />
                    <Route path="agents/:agentId/:tab/:itemId" element={<AgentsPage />} />
                    <Route path="events" element={<EventsPage />} />
                    <Route path="quests" element={<QuestsPage />} />
                    <Route path="ideas" element={<IdeasPage />} />
                    <Route path="sessions" element={<SessionsPage />} />
                    <Route path="settings" element={<CompanyPage />} />
                    <Route
                      path="treasury"
                      element={
                        <PlatformOnlyRoute>
                          <TreasuryPage />
                        </PlatformOnlyRoute>
                      }
                    />
                    <Route
                      path="drive"
                      element={
                        <PlatformOnlyRoute>
                          <DrivePage />
                        </PlatformOnlyRoute>
                      }
                    />
                    <Route
                      path="apps"
                      element={
                        <PlatformOnlyRoute>
                          <AppsPage />
                        </PlatformOnlyRoute>
                      }
                    />
                    <Route
                      path="market"
                      element={
                        <PlatformOnlyRoute>
                          <MarketPage />
                        </PlatformOnlyRoute>
                      }
                    />
                    <Route path="account" element={<ModeAwareAccountRoute />} />
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

function ModeAwareAccountRoute() {
  const appMode = useAuthStore((s) => s.appMode);
  return appMode === "platform" ? <AccountPage /> : <Navigate to="settings" replace />;
}

function ModeAwareSettingsRedirect() {
  const appMode = useAuthStore((s) => s.appMode);
  const activeCompany = localStorage.getItem("aeqi_company");
  const base = activeCompany ? `/${encodeURIComponent(activeCompany)}` : "/";
  return <Navigate to={appMode === "platform" ? `${base}/account` : `${base}/settings`} replace />;
}

function PlatformOnlyRoute({ children }: { children: React.ReactNode }) {
  const appMode = useAuthStore((s) => s.appMode);
  return appMode === "platform" ? <>{children}</> : <Navigate to="settings" replace />;
}
