/**
 * @aeqi/web-shared/analytics — provider-agnostic analytics machinery.
 *
 * Canonical home for the AnalyticsProvider interface, the React provider
 * + hooks, and the Plausible / Null adapters. Both apps/ui and
 * aeqi-landing import from this package.
 *
 * What lives in this package:
 *   - AnalyticsProvider interface, Events vocabulary
 *   - NullAnalytics + PlausibleAnalytics adapters
 *   - <AnalyticsProvider> React component + useAnalytics + useTrack
 *
 * What does NOT live here (and shouldn't):
 *   - Consent storage — different storage keys per app
 *   - The createAnalytics factory — different env vars / defaults per app
 *
 * Each app ships those two thin pieces in its own `src/lib/analytics/`.
 */

export { AnalyticsProvider } from "./context";
export { useAnalytics, useTrack } from "./hooks";
export { Events } from "./types";
export { NullAnalytics, nullAnalytics } from "./null";
export { PlausibleAnalytics } from "./plausible";
export type { PlausibleConfig } from "./plausible";
export type {
  AnalyticsProvider as IAnalyticsProvider,
  AnalyticsProps,
  EventName,
} from "./types";
