import type { AnalyticsProps, AnalyticsProvider } from "./types";

declare global {
  interface Window {
    plausible?: ((
      event: string,
      options?: { props?: AnalyticsProps; callback?: () => void; u?: string },
    ) => void) & { q?: unknown[] };
  }
}

export interface PlausibleConfig {
  /** Domain registered with Plausible (e.g. `app.aeqi.ai`). */
  domain: string;
  /** Self-hosted Plausible base URL (e.g. `https://analytics.aeqi.ai`). */
  apiHost: string;
  /**
   * Script variant — selects which Plausible plugins are bundled.
   * Defaults to the manual variant so SPA pageviews are explicit.
   * See https://plausible.io/docs/script-extensions
   */
  scriptVariant?: string;
  /** Start in enabled state. Useful when consent is already on record. */
  initiallyEnabled?: boolean;
}

/**
 * Plausible adapter.
 *
 * The script is injected lazily the first time `setEnabled(true)` runs,
 * so unconsented users don't load a tracker at all. The `manual` variant
 * disables auto-pageview; we fire pageviews ourselves via the React
 * `useTrackPageview` hook so SPA navigations are tracked the same way as
 * the initial load — and so swapping to a different provider doesn't
 * silently lose route changes.
 */
export class PlausibleAnalytics implements AnalyticsProvider {
  private enabled: boolean;
  private scriptInjected = false;
  private readonly config: PlausibleConfig;

  constructor(config: PlausibleConfig) {
    this.config = config;
    this.enabled = config.initiallyEnabled ?? false;
    if (this.enabled) this.ensureScript();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) this.ensureScript();
  }

  pageview(path: string, props?: AnalyticsProps): void {
    if (!this.enabled) return;
    const url =
      typeof window !== "undefined" ? window.location.origin + path : path;
    this.call("pageview", { props, u: url });
  }

  track(event: string, props?: AnalyticsProps): void {
    if (!this.enabled) return;
    this.call(event, props ? { props } : undefined);
  }

  private call(
    event: string,
    options?: { props?: AnalyticsProps; u?: string },
  ): void {
    if (typeof window === "undefined") return;
    // Plausible's standard queue shim. Calls made before the script
    // finishes loading land in `plausible.q` and are flushed by the
    // script on init. Once loaded, `window.plausible` is replaced with
    // the real implementation.
    if (!window.plausible) {
      const queue: unknown[] = [];
      const stub = ((e: string, o?: object) =>
        queue.push([e, o])) as Window["plausible"];
      (stub as { q?: unknown[] }).q = queue;
      window.plausible = stub;
    }
    window.plausible!(event, options);
  }

  private ensureScript(): void {
    if (this.scriptInjected) return;
    if (typeof document === "undefined") return;
    const variant =
      this.config.scriptVariant ??
      "manual.outbound-links.file-downloads.tagged-events";
    const src = `${this.config.apiHost.replace(/\/$/, "")}/js/script.${variant}.js`;
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${src}"]`,
    );
    if (existing) {
      this.scriptInjected = true;
      return;
    }
    const tag = document.createElement("script");
    tag.defer = true;
    tag.src = src;
    tag.setAttribute("data-domain", this.config.domain);
    tag.setAttribute(
      "data-api",
      `${this.config.apiHost.replace(/\/$/, "")}/api/event`,
    );
    document.head.appendChild(tag);
    this.scriptInjected = true;
  }
}
