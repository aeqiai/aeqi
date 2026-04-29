/**
 * Provider-agnostic analytics surface.
 *
 * Components depend on this interface, not on a vendor. To swap Plausible
 * for a different tool (PostHog, Umami, our own pixel), implement
 * `AnalyticsProvider` and pass the instance to `<AnalyticsProvider>`.
 *
 * Event names are semantic (`<noun>_<verb>`), not vendor-specific. Props
 * are flat string maps — matches Plausible's custom-properties shape and
 * is the lowest common denominator across vendors.
 */

export type AnalyticsProps = Record<string, string>;

export interface AnalyticsProvider {
  /** Record a page view. SPA-aware: call on every route change. */
  pageview(path: string, props?: AnalyticsProps): void;

  /** Record a custom event. */
  track(event: string, props?: AnalyticsProps): void;

  /**
   * Toggle collection. When false, all subsequent pageview/track calls
   * are dropped. When flipping to true a provider may lazy-load its
   * underlying SDK.
   */
  setEnabled(enabled: boolean): void;

  /** Whether collection is currently active. */
  isEnabled(): boolean;
}

/**
 * Canonical event vocabulary for apps/ui. Add new events here so the
 * dashboard side and analytics warehouse share one source of truth.
 *
 * Naming: `<noun>_<verb>`. Past-tense verbs for completed actions
 * (`company_created`), bare verbs for initiated actions
 * (`auth_signup_start`).
 */
export const Events = {
  // Auth funnel
  AuthSignupStart: "auth_signup_start",
  AuthSignupComplete: "auth_signup_complete",
  AuthLogin: "auth_login",
  AuthLogout: "auth_logout",

  // Company lifecycle
  CompanyCreate: "company_create",
  CompanyCreated: "company_created",

  // Primitives
  AgentCreated: "agent_created",
  QuestCreated: "quest_created",
  IdeaCreated: "idea_created",
  EventCreated: "event_created",

  // Engagement
  CtaClick: "cta_click",
  ConsentGranted: "consent_granted",
  ConsentRevoked: "consent_revoked",
} as const;

export type EventName = (typeof Events)[keyof typeof Events] | (string & {});
