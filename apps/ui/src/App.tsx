import { lazy, Suspense, useEffect } from "react";
import type { ReactNode } from "react";
import { Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { Spinner } from "@/components/ui";
import AppLayout from "@/components/AppLayout";
import SessionRedirect from "@/components/SessionRedirect";
import { entityPath } from "@/lib/entityPath";

// Auth pages -- loaded eagerly since they gate entry
import LoginPage from "@/pages/LoginPage";
import SignupPage from "@/pages/SignupPage";
import WelcomePage from "@/pages/WelcomePage";
import VerifyEmailPage from "@/pages/VerifyEmailPage";
import AuthCallbackPage from "@/pages/AuthCallbackPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import MagicLinkPage from "@/pages/MagicLinkPage";
import InvitationAcceptPage from "@/pages/InvitationAcceptPage";

// App pages -- lazy-loaded for route-level code splitting
const AgentsPage = lazy(() => import("@/pages/AgentsPage"));
const ChangePasswordPage = lazy(() => import("@/pages/ChangePasswordPage"));
const PublicProfilePage = lazy(() => import("@/pages/PublicProfilePage"));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage"));

/**
 * Top-level URL segments that must NEVER resolve to a public profile.
 * These collide with auth pages, app shell, API, and assets surfaces; if
 * a Company's entity_id ever matched one of them the public-profile
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
  "start",
  "studio",
  "economy",
  "blueprints",
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
 * `/account`, `/admin`, `/start`, etc. continue to render the in-shell
 * app surface for authenticated users (and bounce to /login for
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

const LoadingSpinner = () => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      minHeight: "100vh",
      color: "var(--color-text-muted)",
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
 * Wrapper for `/` (Economy front door) and `/blueprints` — both top-level
 * destinations that mount the app shell. Authed visitors hit the full
 * AppLayout, which dispatches the matching page from the URL. Unauthed
 * visitors bounce to /login — the public-marketing variants of these
 * surfaces are paused until they're production-ready; PublicLayout stays
 * in the tree for when we revive them.
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

/**
 * Bare `/` while authed lands on the user's primary entity inbox —
 * the daily-action surface. Resolved at nav-time from the daemon
 * store: prefer the `host`-typed placement (the platform-owner
 * carve-out, per `architecture_user_account_is_company.md`); fall
 * back to `entities[0]`. Until entities load, render the Economy
 * shell so the user lands on something coherent rather than a
 * spinner. Unauthed visitors and `auth=none` mode see the
 * Economy/AppLayout dispatch via GatedAppShell.
 */
function RootRouteSwitch() {
  const authMode = useAuthStore((s) => s.authMode);
  const token = useAuthStore((s) => s.token);
  const fetchAuthMode = useAuthStore((s) => s.fetchAuthMode);
  const entities = useDaemonStore((s) => s.entities);
  const initialLoaded = useDaemonStore((s) => s.initialLoaded);
  const fetchEntities = useDaemonStore((s) => s.fetchEntities);

  useEffect(() => {
    fetchAuthMode();
  }, [fetchAuthMode]);

  // The daemon store is normally hydrated by AppLayout's `fetchAll`
  // — but this branch fires BEFORE AppLayout mounts. Kick the
  // entities fetch ourselves so we can resolve a primary inbox URL
  // for habitual users without falling through to the Economy front
  // door first. No-op when entities are already cached.
  useEffect(() => {
    if (authMode && authMode !== "none" && token && !initialLoaded) {
      void fetchEntities();
    }
  }, [authMode, token, initialLoaded, fetchEntities]);

  if (!authMode) return <LoadingSpinner />;
  if (authMode !== "none" && token) {
    if (!initialLoaded) return <LoadingSpinner />;
    const host = entities.find((e) => e.placement_type === "host");
    const primary = host ?? entities[0] ?? null;
    if (primary) {
      return <Navigate to={entityPath(primary, "inbox")} replace />;
    }
    // No entity yet — render the in-shell Economy front door so the
    // user can pick / create one rather than dead-ending.
    return <GatedAppShell />;
  }
  return <GatedAppShell />;
}

// `/` is only the user-scope landing before an entity exists. Once an entity
// exists, AppLayout canonicalizes the shell to `/c/:entityId` so sidebar tabs
// never generate bogus top-level paths like `/quests`.

/**
 * Entity-root URL architecture. The app shell lives at
 * `/trust/:trustAddress/...` (canonical) or `/c/:entityId/...` (pending
 * fallback); the sidebar always navigates inside that entity. Child
 * agents remain addressable at `/trust/<addr>/agents/:agentId/...`.
 * The user's account-level surface (login profile, billing, settings)
 * lives at `/account` — it's user-scoped, not entity-scoped. There is
 * NO `/me/*` namespace: every entity is a Company entity (founder
 * direction 2026-05-07). Bare `/` resolves to the user's primary
 * entity inbox via `RootRouteSwitch`.
 */
export default function App() {
  // Protected app shell — extracted so the public-profile route can
  // delegate to it for reserved slugs (`/account`, `/admin`, `/start`,
  // etc.) without router-shadowing collisions.
  const protectedTree = (
    <ProtectedRoute>
      <Routes>
        {/* Standalone full-page routes — wizard-style surfaces that
            intentionally do NOT inherit the shell. */}
        <Route path="agents" element={<AgentsPage />} />
        <Route path="change-password" element={<ChangePasswordPage />} />

        {/* Legacy flat session URL — resolves the owning agent +
            entity, then Navigate replace to the canonical deep shape. */}
        <Route path="sessions/:sessionId" element={<SessionRedirect />} />

        {/* Account surface + every company at /trust/<addr>/... share
            the same shell — AppLayout decides content from path. */}
        <Route element={<AppLayout />}>
          <Route path="account" element={null} />
          <Route path="account/:tab" element={null} />
          <Route path="admin" element={null} />
          <Route path="start" element={null} />
          <Route path="start/:slug" element={null} />
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
          <Route path="c/:entityId" element={null}>
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
      <Suspense fallback={<LoadingSpinner />}>
        <Routes>
          {/* Public auth routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          {/* Welcome — combined sign-in / sign-up under the new
              "every user = a Company" model. Three-door entry
              (Solana wallet · passkey · email), animated live spawn,
              direct land on /trust/<pubkey>/. Slated to replace
              /login + /signup as canonical front door once the auth
              cutover lands. */}
          <Route path="/welcome" element={<WelcomePage />} />
          <Route path="/start" element={<Navigate to="/welcome" replace />} />
          <Route path="/waitlist" element={<Navigate to="/signup" replace />} />
          <Route path="/verify" element={<VerifyEmailPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/auth/magic" element={<MagicLinkPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          {/* Public invitation accept page — no auth required to view */}
          <Route path="/invitations/:token" element={<InvitationAcceptPage />} />

          {/* `/` is the Economy front door — rendered inside AppLayout
              so the sidebar (with Economy lit) is always present. The
              previous shell-rendered Inbox at `/` shifted to
              `/trust/<addr>/inbox` (Phase-1 sidebar lock); authed
              users hitting bare `/` resolve to their primary entity's
              inbox via `RootRouteSwitch`. `/economy` is a public
              surface (per project_public_app_surfaces.md) — it must
              render for authed users too, NOT bounce to the inbox.
              Mount it via GatedAppShell so unauthed visitors hit
              /login and authed visitors land on the in-shell Economy
              with the sidebar. */}
          <Route path="/" element={<RootRouteSwitch />} />
          <Route path="/economy" element={<GatedAppShell />} />
          <Route path="/economy/*" element={<GatedAppShell />} />

          {/* Blueprints — top-level destination, auth-gated end-to-end.
              GatedAppShell dispatches AppLayout for authed visitors and
              redirects everyone else to /login?next=<here>. Will revert
              to a public-marketing variant once that surface ships. */}
          {/* Studio — Architect surface (Wave 34 Phase 1). Top-level
              destination, auth-gated end-to-end. Same dispatch shape as
              /blueprints — GatedAppShell mounts AppLayout for authed
              visitors and bounces everyone else to /login?next=<here>. */}
          <Route path="/studio" element={<GatedAppShell />} />
          <Route path="/studio/*" element={<GatedAppShell />} />
          <Route path="/blueprints" element={<GatedAppShell />} />
          <Route path="/blueprints/companies" element={<GatedAppShell />} />
          <Route path="/blueprints/agents" element={<GatedAppShell />} />
          <Route path="/blueprints/events" element={<GatedAppShell />} />
          <Route path="/blueprints/quests" element={<GatedAppShell />} />
          <Route path="/blueprints/ideas" element={<GatedAppShell />} />
          <Route path="/blueprints/:slug" element={<GatedAppShell />} />
          <Route path="/blueprints/:slug/:section" element={<GatedAppShell />} />

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
