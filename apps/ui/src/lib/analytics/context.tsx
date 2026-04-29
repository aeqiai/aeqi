import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { AnalyticsContext } from "./_context";
import { useAnalytics } from "./hooks";
import { onConsentChange, readConsent } from "./consent";
import type { AnalyticsProvider as AnalyticsProviderType } from "./types";

interface ProviderProps {
  analytics: AnalyticsProviderType;
  children: React.ReactNode;
}

/**
 * Wires a provider into React + reacts to consent changes. Place inside
 * the router so `<PageviewTracker>` can read `useLocation`.
 */
export function AnalyticsProvider({ analytics, children }: ProviderProps) {
  useEffect(() => {
    analytics.setEnabled(readConsent() === "all");
    return onConsentChange((level) => analytics.setEnabled(level === "all"));
  }, [analytics]);

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
