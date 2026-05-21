import { lazy, Suspense, useEffect } from "react";
import type { ReactNode } from "react";
import { Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { Loading } from "@/components/ui";
import AppLayout from "@/components/AppLayout";
import SessionRedirect from "@/components/SessionRedirect";

// Primary auth page -- loaded eagerly since it gates entry.
//
// `/login`, `/signup`, and `/welcome` all render `<WelcomePage />` with
// different `mode` props. Per the canonical "every user = a Company"
// model, sign-in and sign-up are the same act — the auth method
// resolves new vs returning via the `auth_methods` table on the
// platform side. Three URLs kept live so muscle-memory bookmarks
// (`/login`), marketing/SEO (`/signup`), and the canonical post-auth
// landing (`/welcome`) all land on the same flow with subtly different
// copy framings.
import WelcomePage from "@/pages/WelcomePage";

// App pages -- lazy-loaded for route-level code splitting
const AgentsPage = lazy(() => import("@/pages/AgentsPage"));
const ChangePasswordPage = lazy(() => import("@/pages/ChangePasswordPage"));
const InvitationAcceptPage = lazy(() => import("@/pages/InvitationAcceptPage"));
const MagicLinkPage = lazy(() => import("@/pages/MagicLinkPage"));
const OnboardingPage = lazy(() => import("@/pages/OnboardingPage"));
const PublicProfilePage = lazy(() => import("@/pages/PublicProfilePage"));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage"));
const ResetPasswordPage = lazy(() => import("@/pages/ResetPasswordPage"));
const VerifyEmailPage = lazy(() => import("@/pages/VerifyEmailPage"));

/**
 * Top-level URL segments that must NEVER resolve to a public profile.
 * These collide with auth pages, app shell, API, and assets surfaces; if
 * a Company's trust_id ever matched one of them the public-profile
 * route would shadow real product surfaces. Listed here once so the
 * `<PublicProfileRoute />` guard and any future entity-id validator can
 * agree on the deny list.
 */
const RESERVED_SLUGS = new Set([
  "api",
  "auth",
  "account",
  "c",
  "trust",
  "launch",
  "blueprints",
  "economy",
  "acting-as",
  "inbox",
  "start",
  "network",
  "identity",
  "onboarding",
  "signup",
  "login",
  "verify",
  "waitlist",
  "reset-password",
  "invitations",
  "admin",
  "agents",
  "change-password",
  "sessions",
  "assets",
  "static",
  "signin",
]);

/**
 * Public-profile route wrapper. Renders the profile page only when the
 * URL segment is NOT a reserved slug; reserved slugs (auth pages, app
 * shell paths, asset prefixes) delegate to the authed protected tree so
 * `/account`, `/admin`, etc. continue to render the in-shell app
 * surface for authenticated users (and bounce to /login for
 * everyone else, the same as before this route existed). Without this
 * delegation react-router would prefer `/:slug` over `/*` and shadow
 * `/account` for authenticated users.
 */
function PublicProfileRoute({ protectedFallback }: { protectedFallback: ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  if (!slug) return <NotFoundPage />;
  if (RESERVED_SLUGS.has(slug.toLowerCase())) {
    return <>{protectedFallback}</>;
  }
  return <PublicProfilePage />;
}

const LoadingFallback = () => <Loading variant="page" label="Loading application" />;

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

  if (!authMode) return <LoadingFallback />;
  if (authMode === "none") return <>{children}</>;
  if (!token) {
    const here = location.pathname + location.search;
    const dest = here === "/" ? "/login" : `/login?next=${encodeURIComponent(here)}`;
    return <Navigate to={dest} replace />;
  }
  return <>{children}</>;
}

/**
 * Wrapper for top-level app-shell destinations like `/launch` and
 * `/blueprints`. Authed visitors hit the full AppLayout, which dispatches
 * the matching page from the URL. Unauthed visitors bounce to /login — the
 * public-marketing variants of these surfaces are paused until they're
 * production-ready.
 */
function GatedAppShell() {
  const location = useLocation();
  const authMode = useAuthStore((s) => s.authMode);
  const token = useAuthStore((s) => s.token);
  const fetchAuthMode = useAuthStore((s) => s.fetchAuthMode);

  useEffect(() => {
    fetchAuthMode();
  }, [fetchAuthMode]);

  if (!authMode) return <LoadingFallback />;
  if (authMode === "none" || token) return <AppLayout />;
  const here = location.pathname + location.search;
  return <Navigate to={`/login?next=${encodeURIComponent(here)}`} replace />;
}

/**
 * Bare `/` while authed lands on the user's primary entity inbox —
 * the daily-action surface. Resolved at nav-time from the daemon
 * store: prefer the `host`-typed placement (the platform-owner
 * carve-out, per `architecture_user_account_is_company.md`); fall
 * back to `entities[0]`. Until entities load, wait briefly rather than
 * flashing another shell destination. If the user has no company yet,
 * send them to the working launch flow. Unauthed visitors still bounce
 * through the auth gate.
 */
function RootRouteSwitch() {
  // The root `/` surface is the home picker (node-grid of actor × role ×
  // trust contexts). GatedAppShell handles the auth gate; AppLayout mounts
  // and dispatches `path === "/"` → StartPage. No redirects to /launch or
  // /trust/<addr> anymore — the start page IS the daily-landing.
  return <GatedAppShell />;
}

// `/` is only the user-scope landing before an organization exists. Once an
// organization exists, AppLayout keeps the shell on the trust route so
// sidebar tabs never generate bogus top-level paths like `/quests`.

/**
 * Trust-root URL architecture. The app shell lives at
 * `/trust/:trustAddress/...` (canonical); the sidebar always navigates
 * inside that entity. Child
 * agents remain addressable at `/trust/<addr>/agents/:agentId/...`.
 * The user's account-level surface (login profile, billing, settings)
 * lives at `/account` — it's user-scoped, not entity-scoped. There is
 * NO `/me/*` namespace: every entity is a Company entity (founder
 * direction 2026-05-07). Bare `/` resolves to the user's primary
 * entity inbox via `RootRouteSwitch`.
 */
export default function App() {
  // Protected app shell — extracted so the public-profile route can
  // delegate to it for reserved slugs (`/account`, `/admin`,
  // etc.) without router-shadowing collisions.
  const protectedTree = (
    <ProtectedRoute>
      <Routes>
        {/* Standalone full-page routes — wizard-style surfaces that
            intentionally do NOT inherit the shell. */}
        <Route path="agents" element={<AgentsPage />} />
        <Route path="change-password" element={<ChangePasswordPage />} />
        <Route path="onboarding" element={<OnboardingPage />} />

        {/* Legacy flat session URL — resolves the owning agent +
            entity, then Navigate replace to the canonical deep shape. */}
        <Route path="sessions/:sessionId" element={<SessionRedirect />} />

        {/* Account surface + every company at /trust/<addr>/... share
              the same shell — AppLayout decides content from path. */}
        <Route element={<AppLayout />}>
          <Route path="account" element={null} />
          <Route path="account/:tab" element={null} />
          <Route path="admin" element={null} />
          <Route path="launch" element={null} />
          <Route path="launch/:blueprintId" element={null} />
          <Route path="economy" element={null} />
          <Route path="economy/:tab" element={null} />
          <Route path="acting-as" element={null} />
          <Route path="inbox" element={null} />
          <Route path="start" element={null} />
          <Route path="network" element={null} />
          <Route path="identity" element={null} />
          {/* Canonical trusts-picker route as of 2026-05-19. Bare `/trust`
              (no address) renders the picker; `/trust/<addr>/...` below
              is the entity shell. */}
          <Route path="trust" element={null} />
          <Route path="trust/:trustAddress" element={null}>
            <Route index element={null} />
            <Route path="agents/:agentId" element={null}>
              <Route index element={null} />
              <Route path="settings" element={null} />
              <Route path="settings/:settingsTab" element={null} />
              <Route path="settings/:settingsTab/:itemId" element={null} />
              <Route path=":tab" element={null} />
              <Route path=":tab/:itemId" element={null} />
            </Route>
            <Route path="roles/new" element={null} />
            <Route path="roles/:roleId" element={null} />
            <Route path="roles/:roleId/edit" element={null} />
            <Route path="roles/:roleId/invite" element={null} />
            <Route path=":tab" element={null} />
            <Route path=":tab/:itemId" element={null} />
          </Route>
          {/* Catch-all 404 inside the protected shell. Lives last. */}
          <Route path="*" element={null} />
        </Route>
      </Routes>
    </ProtectedRoute>
  );

  return (
    <ErrorBoundary>
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          {/* Public auth routes — three URLs, one component, three
              copy modes. Per "every user = a Company": sign-in and
              sign-up are the same act, the auth method resolves new
              vs returning. All three render `<WelcomePage />` with a
              different `mode` so muscle-memory + marketing + canonical
              post-auth landing all work without wasted friction. */}
          <Route path="/login" element={<WelcomePage mode="login" />} />
          <Route path="/signup" element={<WelcomePage mode="signup" />} />
          <Route path="/welcome" element={<WelcomePage mode="welcome" />} />
          {/* `/launch` is the sole in-shell Company-launch surface.
              Routes through GatedAppShell so the LeftSidebar stays
              mounted and unauth visitors bounce to /login. */}
          <Route path="/waitlist" element={<Navigate to="/signup" replace />} />
          <Route path="/verify" element={<VerifyEmailPage />} />
          <Route path="/auth/magic" element={<MagicLinkPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          {/* Public invitation accept page — no auth required to view */}
          <Route path="/invitations/:token" element={<InvitationAcceptPage />} />

          {/* Standalone protected routes must live before `/:slug`.
              Otherwise reserved slugs delegate from the public-profile
              match and descendant routing falls through to the shell 404. */}
          <Route
            path="/agents"
            element={
              <ProtectedRoute>
                <AgentsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/change-password"
            element={
              <ProtectedRoute>
                <ChangePasswordPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/onboarding"
            element={
              <ProtectedRoute>
                <OnboardingPage />
              </ProtectedRoute>
            }
          />

          {/* Bare `/` resolves to the user's primary entity inbox when
              they have one. Users without a company go straight to
              `/launch`. */}
          <Route path="/" element={<RootRouteSwitch />} />

          {/* Blueprints — top-level destination, auth-gated end-to-end.
              GatedAppShell dispatches AppLayout for authed visitors and
              redirects everyone else to /login?next=<here>. Will revert
              to a public-marketing variant once that surface ships. */}
          <Route path="/blueprints" element={<GatedAppShell />} />
          <Route path="/blueprints/companies" element={<GatedAppShell />} />
          <Route path="/blueprints/agents" element={<GatedAppShell />} />
          <Route path="/blueprints/events" element={<GatedAppShell />} />
          <Route path="/blueprints/quests" element={<GatedAppShell />} />
          <Route path="/blueprints/ideas" element={<GatedAppShell />} />
          <Route path="/blueprints/:blueprintId" element={<GatedAppShell />} />
          <Route path="/blueprints/:blueprintId/:section" element={<GatedAppShell />} />

          {/* Public profile — top-level `/<slug>` route. Lives BEFORE the
              authed catch-all so unauth visitors can hit a Company's
              public profile without bouncing to /login. Reserved slugs
              (api / auth / me / c / trust / login / signup / etc.)
              delegate to the protected tree so authed surfaces continue
              to render correctly for those segments. */}
          <Route path="/:slug" element={<PublicProfileRoute protectedFallback={protectedTree} />} />

          {/* Protected routes — catches everything not handled above. */}
          <Route path="/*" element={protectedTree} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
