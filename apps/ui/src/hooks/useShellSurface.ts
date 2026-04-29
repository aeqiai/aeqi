import { useMemo } from "react";

/**
 * Pure derivation: turn the current URL state into a set of named
 * surface flags the AppLayout shell can switch on. Lifted out of
 * AppLayout because the regex-and-flag soup obscured the actual
 * rendering logic — and because every flag is a function of three
 * cheap inputs (path, entityId, tab), so a single `useMemo` is
 * cheaper than the eight inline derivations it replaces.
 *
 * `userSessionId` is parsed from the path because `/sessions/:id`
 * is registered as a literal user-scope route in App.tsx — the
 * `/c/:entityId` matcher would otherwise eat it.
 */
export interface ShellSurface {
  isHome: boolean;
  isSettings: boolean;
  isBlueprints: boolean;
  isEconomy: boolean;
  isDrive: boolean;
  isStart: boolean;
  isUserSession: boolean;
  /** True when the path doesn't match any known shell surface — drives the
   *  in-shell 404 dispatch. Stays false for `/`, `/me/...`, `/start`,
   *  `/sessions/:id`, `/economy/...`, and `/c/:entityId/...`. */
  isNotFound: boolean;
  /** `/me/inbox` — the action queue. Distinct from `/` (the feed). */
  isMyInbox: boolean;
  /** `/me/quests` — quests assigned to you across companies (stub). */
  isMyQuests: boolean;
  /** `/me/portfolio` — equity / treasury share (stub). */
  isMyPortfolio: boolean;
  /** Session id from /sessions/:sessionId (user-scope inbox view). */
  userSessionId: string | null;
  /** Blueprint slug from /economy/blueprints/:slug — null on the catalog
   *  list itself. AppLayout uses this to dispatch the detail page vs the
   *  catalog so authed users don't get stuck on the catalog when
   *  deep-linking a specific blueprint. */
  blueprintSlug: string | null;
}

export function useShellSurface(path: string, tab: string | undefined): ShellSurface {
  return useMemo(() => {
    const userSessionMatch = path.match(/^\/sessions\/([^/]+)\/?$/);
    const userSessionId = userSessionMatch ? decodeURIComponent(userSessionMatch[1]) : null;
    const isUserSession = !!userSessionId;

    // /me/* family. The user-scope namespace splits into:
    //   - settings: /me, /me/profile, /me/billing, /me/security, …
    //   - my-inbox: /me/inbox (the action queue)
    //   - my-quests: /me/quests (stub)
    //   - my-portfolio: /me/portfolio (stub)
    // Settings owns the catch-all so any unrecognised /me/<x> falls
    // back to the existing ProfilePage rather than 404.
    const isMyInbox = path === "/me/inbox";
    const isMyQuests = path === "/me/quests";
    const isMyPortfolio = path === "/me/portfolio";
    const isMyCustom = isMyInbox || isMyQuests || isMyPortfolio;
    const isSettings =
      !isMyCustom && (path === "/me" || path.startsWith("/me/") || tab === "profile");
    const isBlueprints = path === "/economy/blueprints" || path.startsWith("/economy/blueprints/");
    const blueprintMatch = path.match(/^\/economy\/blueprints\/([^/]+)\/?$/);
    const blueprintSlug = blueprintMatch ? decodeURIComponent(blueprintMatch[1]) : null;
    const isEconomy = path === "/economy" || path.startsWith("/economy/");
    const isStart = path === "/start";
    const isDrive = tab === "drive";

    // A path is "known" when it matches one of the registered shell
    // surfaces. Anything else is a 404 — including bogus top-level
    // segments (`/foo`) that would otherwise fall through to a stale
    // active-entity render.
    const isCompanyRoute = path === "/" || /^\/c\/[^/]+(\/|$)/.test(path);
    const isKnownShellRoute = isCompanyRoute || isSettings || isEconomy || isStart || isUserSession;
    const isNotFound = !isKnownShellRoute;

    // isHome is now path-based: it fires only at literal `/`, the user
    // feed surface. `/c/<entity>` is its own (company feed) surface —
    // dispatched directly in AppLayout from routeEntityId, not via
    // isHome. The earlier `!entityId` heuristic is gone.
    const isHome =
      path === "/" &&
      !isSettings &&
      !isMyCustom &&
      !isBlueprints &&
      !isEconomy &&
      !isStart &&
      !isUserSession &&
      !isNotFound;

    return {
      isHome,
      isSettings,
      isBlueprints,
      isEconomy,
      isDrive,
      isStart,
      isUserSession,
      isNotFound,
      isMyInbox,
      isMyQuests,
      isMyPortfolio,
      userSessionId,
      blueprintSlug,
    };
  }, [path, tab]);
}
