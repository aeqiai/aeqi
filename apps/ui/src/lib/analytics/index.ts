/**
 * Public surface for analytics. Components should import from here only:
 *
 *   import { useTrack, Events } from "@/lib/analytics";
 *
 * Provider wiring (the `createAnalytics` factory + `<AnalyticsProvider>`)
 * lives at the root in `main.tsx`. Adapter implementations
 * (`PlausibleAnalytics`, `NullAnalytics`) are not re-exported — that
 * boundary stays inside this folder so swapping providers is a one-file
 * change.
 */

import { NullAnalytics } from "./null";
import { PlausibleAnalytics } from "./plausible";
import { readConsent } from "./consent";
import type { AnalyticsProvider } from "./types";

export { AnalyticsProvider } from "./context";
export { useAnalytics, useTrack } from "./hooks";
export { Events } from "./types";
export type { AnalyticsProps, EventName } from "./types";
export { readConsent, writeConsent, onConsentChange } from "./consent";
export type { ConsentLevel } from "./consent";

/**
 * Build the analytics instance for this app. Driven by Vite env so tests
 * and ephemeral previews fall back to a no-op without touching any
 * caller. To swap vendors, change the body of this function and the
 * adapter file — every `useTrack()` call site is unchanged.
 */
export function createAnalytics(): AnalyticsProvider {
  const domain = import.meta.env.VITE_ANALYTICS_DOMAIN as string | undefined;
  const apiHost = import.meta.env.VITE_ANALYTICS_HOST as string | undefined;
  if (!domain || !apiHost) return new NullAnalytics();

  return new PlausibleAnalytics({
    domain,
    apiHost,
    initiallyEnabled: readConsent() === "all",
  });
}
