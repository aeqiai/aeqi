import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import AppLayout from "@/components/AppLayout";
import LoginPage from "@/pages/LoginPage";
import SignupPage from "@/pages/SignupPage";
import VerifyEmailPage from "@/pages/VerifyEmailPage";
import AuthCallbackPage from "@/pages/AuthCallbackPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import WelcomePage from "@/pages/WelcomePage";
import RuntimeHomePage from "@/pages/RuntimeHomePage";
import NewCompanyPage from "@/pages/NewCompanyPage";
import AgentsPage from "@/pages/AgentsPage";
import EventsPage from "@/pages/EventsPage";
import QuestsPage from "@/pages/QuestsPage";
import IdeasPage from "@/pages/IdeasPage";
import EntitiesPage from "@/pages/EntitiesPage";
import AccountPage from "@/pages/AccountPage";
import CompanyPage from "@/pages/CompanyPage";
import TreasuryPage from "@/pages/TreasuryPage";
import DrivePage from "@/pages/DrivePage";
import AppsPage from "@/pages/AppsPage";
import MarketPage from "@/pages/MarketPage";
import SessionsPage from "@/pages/SessionsPage";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const authMode = useAuthStore((s) => s.authMode);
  const token = useAuthStore((s) => s.token);
  const fetchAuthMode = useAuthStore((s) => s.fetchAuthMode);

  useEffect(() => {
    fetchAuthMode();
  }, [fetchAuthMode]);

  // Loading mode discovery
  if (!authMode) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div style={{ color: "rgba(0,0,0,0.3)", fontSize: 13 }}>Loading...</div>
      </div>
    );
  }

  if (authMode === "none") return <>{children}</>;
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/waitlist" element={<Navigate to="/signup" replace />} />
      <Route path="/verify" element={<VerifyEmailPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <ModeAwareShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<ModeAwareHome />} />
        <Route path="new" element={<NewCompanyPage />} />
        <Route path="agents" element={<AgentsPage />} />
        <Route path="agents/:agentId" element={<AgentsPage />} />
        <Route path="agents/:agentId/:tab" element={<AgentsPage />} />
        <Route path="agents/:agentId/:tab/:itemId" element={<AgentsPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="quests" element={<QuestsPage />} />
        <Route path="ideas" element={<IdeasPage />} />
        <Route path="workspace" element={<LegacyWorkspaceRoute />} />
        <Route path="company" element={<CompanyPage />} />
        <Route path="companies" element={<EntitiesPage />} />
        <Route path="treasury" element={<PlatformOnlyRoute><TreasuryPage /></PlatformOnlyRoute>} />
        <Route path="drive" element={<PlatformOnlyRoute><DrivePage /></PlatformOnlyRoute>} />
        <Route path="apps" element={<PlatformOnlyRoute><AppsPage /></PlatformOnlyRoute>} />
        <Route path="market" element={<PlatformOnlyRoute><MarketPage /></PlatformOnlyRoute>} />
        <Route path="sessions" element={<SessionsPage />} />
        <Route path="account" element={<ModeAwareAccountRoute />} />
        <Route path="settings" element={<ModeAwareSettingsRoute />} />
      </Route>
    </Routes>
  );
}

function ModeAwareShell() {
  return <AppLayout />;
}

function ModeAwareHome() {
  const appMode = useAuthStore((s) => s.appMode);
  return appMode === "platform" ? <WelcomePage /> : <RuntimeHomePage />;
}

function LegacyWorkspaceRoute() {
  return <Navigate to="/company" replace />;
}

function ModeAwareAccountRoute() {
  const appMode = useAuthStore((s) => s.appMode);
  return appMode === "platform" ? <AccountPage /> : <Navigate to="/company" replace />;
}

function ModeAwareSettingsRoute() {
  const appMode = useAuthStore((s) => s.appMode);
  return <Navigate to={appMode === "platform" ? "/account" : "/company"} replace />;
}

function PlatformOnlyRoute({ children }: { children: React.ReactNode }) {
  const appMode = useAuthStore((s) => s.appMode);
  return appMode === "platform" ? <>{children}</> : <Navigate to="/company" replace />;
}
