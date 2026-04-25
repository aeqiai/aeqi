import { useMemo } from "react";

/**
 * Pure derivation: turn the current URL state into a set of named
 * surface flags the AppLayout shell can switch on. Lifted out of
 * AppLayout because the regex-and-flag soup obscured the actual
 * rendering logic — and because every flag is a function of three
 * cheap inputs (path, agentId, tab), so a single `useMemo` is
 * cheaper than the eight inline derivations it replaces.
 *
 * `userSessionId` is parsed from the path because `/sessions/:id`
 * is registered as a literal user-scope route in App.tsx — react-
 * router's `:agentId` matcher would otherwise eat it.
 */
export interface ShellSurface {
  isHome: boolean;
  isSettings: boolean;
  isBlueprints: boolean;
  isEconomy: boolean;
  isDrive: boolean;
  isUserSession: boolean;
  /** Session id from /sessions/:sessionId (user-scope inbox view). */
  userSessionId: string | null;
}

export function useShellSurface(
  path: string,
  agentId: string,
  tab: string | undefined,
): ShellSurface {
  return useMemo(() => {
    const userSessionMatch = path.match(/^\/sessions\/([^/]+)\/?$/);
    const userSessionId = userSessionMatch ? decodeURIComponent(userSessionMatch[1]) : null;
    const isUserSession = !!userSessionId;

    const isSettings = path === "/settings" || path === "/profile" || tab === "profile";
    const isBlueprints = path === "/blueprints" || path.startsWith("/blueprints/");
    const isEconomy = path === "/economy" || path.startsWith("/economy/");
    const isDrive = tab === "drive";
    const isHome = !agentId && !isSettings && !isBlueprints && !isEconomy && !isUserSession;

    return {
      isHome,
      isSettings,
      isBlueprints,
      isEconomy,
      isDrive,
      isUserSession,
      userSessionId,
    };
  }, [path, agentId, tab]);
}
