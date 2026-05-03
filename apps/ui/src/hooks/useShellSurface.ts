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
  isSettings: boolean;
  isEconomy: boolean;
  isBlueprints: boolean;
  isDrive: boolean;
  isStart: boolean;
  /** True when the path doesn't match any known shell surface — drives the
   *  in-shell 404 dispatch. Stays false for `/me/...`, `/start`,
   *  `/economy/...`, `/blueprints/...`, and `/c/:entityId/...`. */
  isNotFound: boolean;
  /** `/me/portfolio` — personal cross-company view (holdings, performance). */
  isPortfolio: boolean;
  /** `/admin` — operator dashboard. Backend gates on is_admin; the page
   *  itself returns null + bounces non-admins. */
  isAdmin: boolean;
}

export function useShellSurface(path: string, tab: string | undefined): ShellSurface {
  return useMemo(() => {
    // The user-scope namespace `/me/*` is split:
    //   - portfolio: /me/portfolio (cross-company holdings/performance)
    //   - settings:  /me, /me/profile, /me/billing, /me/security, …
    // Settings owns the /me/* catch-all so unrecognised /me/<x> still
    // falls back to ProfilePage rather than 404. Portfolio carves
    // out one specific path before settings resolves it.
    const isPortfolio = path === "/me/portfolio";
    const isAdmin = path === "/admin" || path.startsWith("/admin/");
    const isSettings =
      !isPortfolio && (path === "/me" || path.startsWith("/me/") || tab === "profile");
    // `/` is the canonical Economy URL — the front door of the app
    // shell. `/economy` is kept as an alias and redirects to `/` in
    // App.tsx, but the shell-side flag must match either path so the
    // dispatch lands on EconomyPage in both cases.
    const isEconomy = path === "/" || path === "/economy" || path.startsWith("/economy/");
    const isBlueprints = path === "/blueprints" || path.startsWith("/blueprints/");
    const isStart = path === "/start" || path.startsWith("/start/");
    const isDrive = tab === "drive";

    // A path is "known" when it matches one of the registered shell
    // surfaces. Anything else is a 404 — including bogus top-level
    // segments (`/foo`) that would otherwise fall through to a stale
    // active-entity render. `/` IS in this set: it's the Economy front
    // door (isEconomy === true at `/`).
    const isCompanyRoute = /^\/c\/[^/]+(\/|$)/.test(path);
    const isKnownShellRoute =
      isCompanyRoute ||
      isPortfolio ||
      isSettings ||
      isEconomy ||
      isBlueprints ||
      isStart ||
      isAdmin;
    const isNotFound = !isKnownShellRoute;

    return {
      isSettings,
      isEconomy,
      isBlueprints,
      isDrive,
      isStart,
      isNotFound,
      isPortfolio,
      isAdmin,
    };
  }, [path, tab]);
}
