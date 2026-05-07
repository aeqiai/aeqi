import { lazy, Suspense, useEffect } from "react";
import type { ReactNode } from "react";
import { Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
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
  "me",
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
 * `/me`, `/admin`, `/start`, etc. continue to render the in-shell app
 * surface for authenticated users (and bounce to /login for everyone
 * else, the same as before this route existed). Without this delegation
 * react-router would prefer `/:slug` over `/*` and shadow `/me` for
 * authenticated users.
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
 * Bare `/` while authed lands on `/me/inbox` — the daily-action surface
 * per the personal rail spec. The previous shape fell through to the
 * Economy front door, which is wrong for habitual users (Inbox is the
 * canonical daily destination). Unauthed visitors and `auth=none` mode
 * still see the Economy/AppLayout dispatch via GatedAppShell.
 */
function RootRouteSwitch() {
  const authMode = useAuthStore((s) => s.authMode);
  const token = useAuthStore((s) => s.token);
  const fetchAuthMode = useAuthStore((s) => s.fetchAuthMode);

  useEffect(() => {
    fetchAuthMode();
  }, [fetchAuthMode]);

  if (!authMode) return <LoadingSpinner />;
  if (authMode !== "none" && token) {
    return <Navigate to="/me/inbox" replace />;
  }
  return <GatedAppShell />;
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
  // Protected app shell — extracted so the public-profile route can
  // delegate to it for reserved slugs (`/me`, `/admin`, `/start`, etc.)
  // without router-shadowing collisions.
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

        {/* Home dashboard + profile + every company at /c/:entityId/...
            share the same shell — AppLayout decides content from path. */}
        <Route element={<AppLayout />}>
          <Route path="me" element={null} />
          <Route path="me/:tab" element={null} />
          <Route path="admin" element={null} />
          <Route path="start" element={null} />
          <Route path="start/:slug" element={null} />
          <Route path="trust/:trustAddress" element={null}>
            <Route index element={null} />
            <Route path="agents/:agentId" element={null}>
              <Route index element={null} />
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
              `/c/:entityId/inbox` (Phase-1 sidebar lock); the previous
              fullscreen DiscoverPage at `/` was retired in favor of the
              in-shell Economy. `/economy` is a public surface (per
              project_public_app_surfaces.md) — it must render for
              authed users too, NOT bounce to /me/inbox. Mount it via
              GatedAppShell so unauthed visitors hit /login and authed
              visitors land on the in-shell Economy with the sidebar. */}
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
