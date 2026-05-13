import { lazy, Suspense, useEffect, useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import PageRail from "@/components/PageRail";
import { useAuthStore } from "@/store/auth";
import { EmptyState, Spinner } from "@/components/ui";
import WalletBoundary from "@/components/WalletBoundary";

const ProfilePanel = lazy(() => import("@/pages/Settings/ProfilePanel"));
const BillingPanel = lazy(() => import("@/pages/Settings/BillingPanel"));
const SecurityPanel = lazy(() => import("@/pages/Settings/SecurityPanel"));
const DevicesPanel = lazy(() => import("@/pages/Settings/DevicesPanel"));
const SettingsIntegrationsPage = lazy(() => import("@/pages/Settings/Integrations"));
const ApiKeyPanel = lazy(() => import("@/pages/Settings/ApiKeyPanel"));
const InvitesPanel = lazy(() => import("@/pages/Settings/InvitesPanel"));
const WalletsPanel = lazy(() => import("@/pages/Settings/WalletsPanel"));

const BASE_TABS = [
  { id: "profile", label: "Profile" },
  { id: "billing", label: "Billing" },
  { id: "security", label: "Security" },
  { id: "wallets", label: "Wallets" },
  { id: "devices", label: "Devices" },
  { id: "integrations", label: "Integrations" },
  { id: "api", label: "API keys" },
];
const ADMIN_TAB = { id: "invites", label: "Invites" };

const panelFallback = <Spinner size="md" />;

/**
 * `/account` — user-scoped account shell. Each tab lives in its own
 * component under `pages/Settings/` and owns its own state + data-
 * fetching. This file is a thin router: pick the right panel for the
 * active tab. Splitting was driven by the page reaching 878 lines with
 * six tabs' worth of state interleaved in a single component; the
 * ApiKey + Integrations tabs were already external, the rest followed.
 *
 * Tabs are path-based (`/account/:tab`) to match the rest of the app;
 * legacy `?tab=` URLs redirect to the path form on mount.
 */
export default function ProfilePage() {
  const { tab } = useParams<{ tab?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isAdmin = useAuthStore((s) => s.user?.is_admin === true);

  const tabs = useMemo(() => (isAdmin ? [...BASE_TABS, ADMIN_TAB] : BASE_TABS), [isAdmin]);

  // Backwards-compat: old bookmarks of `/account?tab=security` get
  // bounced to `/account/security` once on mount, then the param is
  // dropped from the address bar.
  useEffect(() => {
    const legacy = searchParams.get("tab");
    if (!legacy) return;
    const known = tabs.some((t) => t.id === legacy);
    const target = known && legacy !== "profile" ? `/account/${legacy}` : "/account";
    navigate(target, { replace: true });
  }, [searchParams, navigate, tabs]);

  const activeTab = !tab ? "profile" : tabs.some((t) => t.id === tab) ? tab : "not-found";

  return (
    <div className="page-rail-shell">
      <PageRail tabs={tabs} defaultTab="profile" title="Account" basePath="/account" />
      <div className="account-page page-rail-content">
        <Suspense fallback={panelFallback}>
          {activeTab === "profile" && <ProfilePanel />}
          {activeTab === "billing" && <BillingPanel />}
          {activeTab === "security" && <SecurityPanel />}
          {activeTab === "wallets" && (
            <WalletBoundary>
              <WalletsPanel />
            </WalletBoundary>
          )}
          {activeTab === "devices" && <DevicesPanel />}
          {activeTab === "integrations" && <SettingsIntegrationsPage />}
          {activeTab === "api" && <ApiKeyPanel />}
          {activeTab === "invites" && <InvitesPanel />}
        </Suspense>
        {activeTab === "not-found" && (
          <EmptyState
            title="Account section not found."
            description="Use the account navigation to open a current settings section."
          />
        )}
      </div>
    </div>
  );
}
