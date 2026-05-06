import { useMemo } from "react";

/**
 * Pure derivation: turn the current URL state into a set of named
 * surface flags the AppLayout shell can switch on. Lifted out of
 * AppLayout because the regex-and-flag soup obscured the actual
 * rendering logic — and because every flag is a function of two cheap
 * inputs (path, tab), so a single `useMemo` is cheaper than the inline
 * derivations it replaces.
 *
 * Phase-1 sidebar lock: `/` is now the Economy front door and renders
 * inside this shell with the sidebar Economy row lit. Inbox moved to
 * `/c/<entity>/inbox` and routes through CompanyPage. The `isMyInbox`
 * flag is gone.
 */
export interface ShellSurface {
  /** True for all `/me/*` paths — MePage dispatches further. */
  isMeRoute: boolean;
  /** @deprecated Use isMeRoute. Kept for AppLayout dispatch compat. */
  isSettings: boolean;
  isEconomy: boolean;
  isBlueprints: boolean;
  /** `/studio` — Architect surface (Wave 34 Phase 1). Free-text brief →
   *  generated Blueprint preview → deploy. Top-level destination, not
   *  scoped to any Company. */
  isStudio: boolean;
  isDrive: boolean;
  isStart: boolean;
  /** True when the path doesn't match any known shell surface — drives the
   *  in-shell 404 dispatch. Stays false for `/me/...`, `/start`,
   *  `/economy/...`, `/blueprints/...`, and `/c/:entityId/...`. */
  isNotFound: boolean;
  /** `/admin` — operator dashboard. Backend gates on is_admin; the page
   *  itself returns null + bounces non-admins. */
  isAdmin: boolean;
  /** In-shell role pages — rendered inside AppLayout. */
  isRolesNew: boolean;
  isRoleDetail: boolean;
  isRoleEdit: boolean;
  isRoleInvite: boolean;
}

export function useShellSurface(path: string, tab: string | undefined): ShellSurface {
  return useMemo(() => {
    const isAdmin = path === "/admin" || path.startsWith("/admin/");
    // All /me/* paths are handled by MePage; isSettings is an alias kept
    // so AppLayout's single dispatch point stays unchanged.
    const isMeRoute = path === "/me" || path.startsWith("/me/") || tab === "profile";
    const isSettings = isMeRoute;
    // `/` is the canonical Economy URL — the front door of the app
    // shell. `/economy` is kept as an alias and redirects to `/` in
    // App.tsx, but the shell-side flag must match either path so the
    // dispatch lands on EconomyPage in both cases.
    const isEconomy = path === "/" || path === "/economy" || path.startsWith("/economy/");
    const isBlueprints = path === "/blueprints" || path.startsWith("/blueprints/");
    const isStudio = path === "/studio" || path.startsWith("/studio/");
    const isStart = path === "/start" || path.startsWith("/start/");
    const isDrive = tab === "drive";

    // In-shell role sub-pages. Matches both /c/:entityId and /trust/:addr shapes.
    const rolePathMatch = path.match(/^\/(?:c\/[^/]+|trust\/[^/]+)\/roles\/(.+)$/);
    const roleSuffix = rolePathMatch ? rolePathMatch[1] : null;
    const isRolesNew = roleSuffix === "new";
    const isRoleInvite = !isRolesNew && !!roleSuffix && roleSuffix.endsWith("/invite");
    const isRoleEdit = !isRolesNew && !!roleSuffix && roleSuffix.endsWith("/edit");
    const isRoleDetail =
      !isRolesNew && !isRoleInvite && !isRoleEdit && !!roleSuffix && !roleSuffix.includes("/");

    // A path is "known" when it matches one of the registered shell
    // surfaces. Anything else is a 404 — including bogus top-level
    // segments (`/foo`) that would otherwise fall through to a stale
    // active-entity render. `/` IS in this set: it's the Economy front
    // door (isEconomy === true at `/`).
    const isCompanyRoute = /^\/c\/[^/]+(\/|$)/.test(path) || /^\/trust\/[^/]+(\/|$)/.test(path);
    const isKnownShellRoute =
      isCompanyRoute || isSettings || isEconomy || isBlueprints || isStudio || isStart || isAdmin;
    const isNotFound = !isKnownShellRoute;

    return {
      isMeRoute,
      isSettings,
      isEconomy,
      isBlueprints,
      isStudio,
      isDrive,
      isStart,
      isNotFound,
      isAdmin,
      isRolesNew,
      isRoleDetail,
      isRoleEdit,
      isRoleInvite,
    };
  }, [path, tab]);
}
