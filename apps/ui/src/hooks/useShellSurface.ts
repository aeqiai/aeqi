import { useMemo } from "react";

/**
 * Pure derivation: turn the current URL state into a set of named
 * surface flags the AppLayout shell can switch on. Lifted out of
 * AppLayout because the regex-and-flag soup obscured the actual
 * rendering logic — and because every flag is a function of two cheap
 * inputs (path, tab), so a single `useMemo` is cheaper than the inline
 * derivations it replaces.
 */
export interface ShellSurface {
  isHome: boolean;
  isSettings: boolean;
  isEconomy: boolean;
  isDrive: boolean;
  isStart: boolean;
  /** True when the path doesn't match any known shell surface — drives the
   *  in-shell 404 dispatch. Stays false for `/`, `/me/...`, `/start`,
   *  `/economy/...`, and `/c/:entityId/...`. */
  isNotFound: boolean;
  /** `/me/inbox` — the global human action queue. */
  isMyInbox: boolean;
}

export function useShellSurface(path: string, tab: string | undefined): ShellSurface {
  return useMemo(() => {
    // /me/* family. The user-scope namespace splits into:
    //   - my-inbox: /me/inbox (the global action queue)
    //   - settings: /me, /me/profile, /me/billing, /me/security, …
    // Settings owns the catch-all so any unrecognised /me/<x> falls
    // back to the existing ProfilePage rather than 404.
    const isMyInbox = path === "/me/inbox";
    const isSettings =
      !isMyInbox && (path === "/me" || path.startsWith("/me/") || tab === "profile");
    const isEconomy = path === "/economy" || path.startsWith("/economy/");
    const isStart = path === "/start";
    const isDrive = tab === "drive";

    // A path is "known" when it matches one of the registered shell
    // surfaces. Anything else is a 404 — including bogus top-level
    // segments (`/foo`) that would otherwise fall through to a stale
    // active-entity render.
    const isCompanyRoute = path === "/" || /^\/c\/[^/]+(\/|$)/.test(path);
    const isKnownShellRoute = isCompanyRoute || isSettings || isEconomy || isStart || isMyInbox;
    const isNotFound = !isKnownShellRoute;

    // isHome fires only at literal `/`, the user feed surface.
    // `/c/<entity>` is the company feed surface, dispatched directly in
    // AppLayout from routeEntityId.
    const isHome = path === "/" && !isNotFound;

    return {
      isHome,
      isSettings,
      isEconomy,
      isDrive,
      isStart,
      isNotFound,
      isMyInbox,
    };
  }, [path, tab]);
}
