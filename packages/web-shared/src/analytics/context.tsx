import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { AnalyticsContext } from "./_context";
import { useAnalytics } from "./hooks";
import type { AnalyticsProvider as AnalyticsProviderType } from "./types";

interface ProviderProps {
  analytics: AnalyticsProviderType;
  /**
   * Initial enabled state — typically `readConsent() === "all"`. Each app
   * keeps its own consent storage; the shared provider doesn't know the
   * key or event names.
   */
  initiallyEnabled?: boolean;
  /**
   * Called once at mount; receives a `setEnabled` callback the app uses
   * to flip the provider on/off when consent changes. Returns a cleanup
   * function (unsubscribe). Pass `onConsentChange` from the app's
   * consent module here.
   */
  subscribeConsent?: (setEnabled: (enabled: boolean) => void) => () => void;
  children: React.ReactNode;
}

/**
 * Wires a provider into React + reacts to consent changes. Place inside
 * the router so `<PageviewTracker>` can read `useLocation`.
 *
 * Consent storage is intentionally NOT bundled here — each app
 * (apps/ui vs aeqi-landing) ships its own consent module and passes
 * `initiallyEnabled` + `subscribeConsent`. That keeps the shared
 * machinery byte-portable.
 */
export function AnalyticsProvider({
  analytics,
  initiallyEnabled,
  subscribeConsent,
  children,
}: ProviderProps) {
  useEffect(() => {
    if (initiallyEnabled !== undefined) analytics.setEnabled(initiallyEnabled);
    if (!subscribeConsent) return;
    return subscribeConsent((enabled) => analytics.setEnabled(enabled));
  }, [analytics, initiallyEnabled, subscribeConsent]);

  return (
    <AnalyticsContext.Provider value={analytics}>
      <PageviewTracker />
      {children}
    </AnalyticsContext.Provider>
  );
}

/**
 * Auto-mounted by `AnalyticsProvider`. Fires a pageview on every route
 * change including the first render. Component-level code never has to
 * think about pageview tracking.
 */
function PageviewTracker() {
  const analytics = useAnalytics();
  const location = useLocation();
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    const path = location.pathname + location.search;
    if (lastPath.current === path) return;
    lastPath.current = path;
    analytics.pageview(path);
  }, [analytics, location.pathname, location.search]);

  return null;
}
