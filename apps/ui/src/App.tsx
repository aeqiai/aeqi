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
import NewWorkspacePage from "@/pages/NewWorkspacePage";
import AgentsPage from "@/pages/AgentsPage";
import EventsPage from "@/pages/EventsPage";
import QuestsPage from "@/pages/QuestsPage";
import InsightsPage from "@/pages/IdeasPage";
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
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<WelcomePage />} />
        <Route path="new" element={<NewWorkspacePage />} />
        <Route path="agents" element={<AgentsPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="quests" element={<QuestsPage />} />
        <Route path="insights" element={<InsightsPage />} />
        <Route path="company" element={<CompanyPage />} />
        <Route path="companies" element={<EntitiesPage />} />
        <Route path="treasury" element={<TreasuryPage />} />
        <Route path="drive" element={<DrivePage />} />
        <Route path="apps" element={<AppsPage />} />
        <Route path="market" element={<MarketPage />} />
        <Route path="sessions" element={<SessionsPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="settings" element={<Navigate to="/account" replace />} />
      </Route>
    </Routes>
  );
}
