import { useMemo } from "react";

/**
 * Pure derivation: turn the current URL path into a set of named surface
 * flags the AppLayout shell can switch on. Lifted out of AppLayout
 * because the regex-and-flag soup obscured the actual rendering logic.
 *
 * The shell now treats the launch surface and the company surfaces as
 * first-class routes. The user-scope MVP entrypoint is `/launch`.
 */
export interface ShellSurface {
  /** Bare `/` — the welcome / Start surface (hero + 4 preview cards).
   *  The root every authed user lands on (2026-05-19 swap: the dominion
   *  picker moved to `/trust`; `/` is now the cinematic welcome). */
  isHome: boolean;
  /** `/trust` — canonical trusts picker as of 2026-05-19. Big active-
   *  trust hero + switcher. Bare `/trust` (no address segment) is the
   *  picker; `/trust/<addr>/...` is the entity shell handled separately.
   *  The 2026-05-19 `/network`, `/identity`, `/acting-as` back-compat
   *  aliases were dropped 2026-05-19 PM — only `/trust` remains. */
  isTrustsPicker: boolean;
  /** True for all `/account/*` paths — ProfilePage dispatches further. */
  isAccount: boolean;
  isBlueprints: boolean;
  /** `/launch` — company formation surface. Left composer + right canvas. */
  isLaunch: boolean;
  /** `/markets/*` — top-level marketplace / inference / billing destination
   *  introduced as part of the "Global" sidebar group on 2026-05-18. */
  isEconomy: boolean;
  /** `/referrals` — global aeqi referral playbook, outside any TRUST. */
  isReferrals: boolean;
  /** Legacy top-level `/inbox` alias. The canonical inbox now lives under
   *  `/trust/<addr>/inbox`; this flag stays so AppLayout can redirect old
   *  bookmarks and routes without mounting a second inbox surface. */
  isInbox: boolean;
  /** `/start` — welcome / first-experience page. Hero image + four
   *  preview cards. Distinct from `/` (the dominion picker) so the
   *  arrival surface stays cinematic instead of double-duty. */
  isStart: boolean;
  /** True when the path doesn't match any known shell surface — drives the
   *  in-shell 404 dispatch. Stays false for `/me/...`, `/launch/...`,
   *  `/templates/...`, and other non-organization routes. */
  isNotFound: boolean;
  /** `/admin` — operator dashboard. Backend gates on is_admin; the page
   *  itself returns null + bounces non-admins. */
  isAdmin: boolean;
  /** In-shell Roles sub-routes. Roles has a canonical workspace at `/roles`
   *  plus object detail at `/roles/:id`. Creation stays query-state on the
   *  workspace; stale `/roles/:id/edit` links collapse to detail. Invite
   *  remains a dedicated flow while invitations are not yet modeled as a
   *  Roles workspace modal. */
  isRolesNew: boolean;
  isRolesDetail: boolean;
  isRolesEdit: boolean;
  isRolesInvite: boolean;
}

export function useShellSurface(path: string): ShellSurface {
  return useMemo(() => {
    const isHome = path === "/";
    const isAdmin = path === "/admin" || path.startsWith("/admin/");
    // All /account/* paths are handled by ProfilePage.
    const isAccount = path === "/account" || path.startsWith("/account/");
    const isBlueprints =
      path === "/templates" ||
      path.startsWith("/templates/") ||
      path === "/blueprints" ||
      path.startsWith("/blueprints/");
    const isLaunch = path === "/launch" || path.startsWith("/launch/");
    const isEconomy =
      path === "/markets" ||
      path.startsWith("/markets/") ||
      path === "/economy" ||
      path.startsWith("/economy/");
    const isReferrals = path === "/referrals" || path.startsWith("/referrals/");
    const isInbox = path === "/inbox" || path.startsWith("/inbox/");
    const isStart = path === "/start" || path.startsWith("/start/");
    // Canonical picker route as of 2026-05-19. The earlier /network,
    // /identity, /acting-as back-compat aliases were retired the same
    // day — only /trust is supported.
    const isTrustsPicker = path === "/trust";

    // Legacy Roles sub-routes on the canonical trust route. These are parsed
    // only so AppLayout can redirect them into the canonical Roles workspace.
    const rolesPathMatch = path.match(/^\/trust\/[^/]+\/roles\/(.+)$/);
    const rolesSuffix = rolesPathMatch ? rolesPathMatch[1] : null;
    const isRolesNew = rolesSuffix === "new";
    const isRolesInvite = !isRolesNew && !!rolesSuffix && rolesSuffix.endsWith("/invite");
    const isRolesEdit = !isRolesNew && !!rolesSuffix && rolesSuffix.endsWith("/edit");
    const isRolesDetail =
      !isRolesNew && !isRolesInvite && !isRolesEdit && !!rolesSuffix && !rolesSuffix.includes("/");

    // A path is "known" when it matches one of the registered shell
    // surfaces. Anything else is a 404 — including bogus top-level
    // segments (`/foo`) that would otherwise fall through to a stale
    // active-entity render.
    const isCompanyRoute = /^\/trust\/[^/]+(\/|$)/.test(path);
    const isKnownShellRoute =
      isHome ||
      isCompanyRoute ||
      isAccount ||
      isBlueprints ||
      isLaunch ||
      isEconomy ||
      isReferrals ||
      isInbox ||
      isStart ||
      isTrustsPicker ||
      isAdmin;
    const isNotFound = !isKnownShellRoute;

    return {
      isHome,
      isAccount,
      isBlueprints,
      isLaunch,
      isEconomy,
      isReferrals,
      isInbox,
      isStart,
      isTrustsPicker,
      isNotFound,
      isAdmin,
      isRolesNew,
      isRolesDetail,
      isRolesEdit,
      isRolesInvite,
    };
  }, [path]);
}
