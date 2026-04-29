import type { AnalyticsProvider } from "./types";

/**
 * No-op provider. Used in tests, SSR, and as the default before consent
 * is granted. Every method is a stable reference so React renders that
 * depend on the provider don't churn.
 */
export class NullAnalytics implements AnalyticsProvider {
  pageview(): void {}
  track(): void {}
  setEnabled(): void {}
  isEnabled(): boolean {
    return false;
  }
}

export const nullAnalytics = new NullAnalytics();
