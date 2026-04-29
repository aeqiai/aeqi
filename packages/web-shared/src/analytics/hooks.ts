import { useContext, useMemo } from "react";
import { AnalyticsContext } from "./_context";
import type { AnalyticsProvider, AnalyticsProps } from "./types";

export function useAnalytics(): AnalyticsProvider {
  return useContext(AnalyticsContext);
}

/**
 * Memoized event firer. Returns a `track(event, props?)` function whose
 * identity is stable for the provider lifetime — safe to use in
 * `useEffect` deps and event handlers.
 */
export function useTrack() {
  const analytics = useAnalytics();
  return useMemo(
    () => (event: string, props?: AnalyticsProps) =>
      analytics.track(event, props),
    [analytics],
  );
}
