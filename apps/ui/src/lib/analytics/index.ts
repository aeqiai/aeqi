/**
 * Public surface for analytics. Components import from here only:
 *
 *   import { useTrack, Events } from "@/lib/analytics";
 *
 * The provider machinery (interface, adapters, React provider, hooks)
 * lives in `@aeqi/web-shared/analytics`. This file wires the
 * apps/ui-specific bits — consent storage and the createAnalytics
 * factory — onto that machinery. To swap vendors, change the body of
 * `createAnalytics` and the underlying adapter.
 */

import { NullAnalytics, PlausibleAnalytics } from "@aeqi/web-shared/analytics";
import type { IAnalyticsProvider } from "@aeqi/web-shared/analytics";
import { readConsent } from "./consent";

export { AnalyticsProvider, useAnalytics, useTrack, Events } from "@aeqi/web-shared/analytics";
export type { AnalyticsProps, EventName } from "@aeqi/web-shared/analytics";
export { readConsent, writeConsent, onConsentChange } from "./consent";
export type { ConsentLevel } from "./consent";

/**
 * Build the analytics instance for this app. Driven by Vite env so tests
 * and ephemeral previews fall back to a no-op without touching any
 * caller. To swap vendors, change the body of this function — every
 * `useTrack()` call site is unchanged.
 */
export function createAnalytics(): IAnalyticsProvider {
  const domain = import.meta.env.VITE_ANALYTICS_DOMAIN as string | undefined;
  const apiHost = import.meta.env.VITE_ANALYTICS_HOST as string | undefined;
  if (!domain || !apiHost) return new NullAnalytics();

  return new PlausibleAnalytics({
    domain,
    apiHost,
    initiallyEnabled: readConsent() === "all",
  });
}
