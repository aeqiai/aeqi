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
  // Auth funnel — every step a user can drop off at
  AuthSignupStart: "auth_signup_start", // email + pw submitted
  AuthSignupVerifySent: "auth_signup_verify_sent", // backend says "check your email"
  AuthSignupComplete: "auth_signup_complete", // verified or directly signed up
  AuthLogin: "auth_login", // login succeeded
  AuthLogout: "auth_logout",
  AuthOauthStart: "auth_oauth_start", // user clicked Google/GitHub button
  AuthWalletStart: "auth_wallet_start", // user clicked Connect Wallet
  AuthPasskeyStart: "auth_passkey_start", // user clicked Continue with Passkey
  AuthPasswordResetRequested: "auth_password_reset_requested",
  AuthPasswordResetCompleted: "auth_password_reset_completed",
  Auth2faChallenged: "auth_2fa_challenged", // 2FA step shown
  Auth2faCompleted: "auth_2fa_completed", // 2FA solved

  // Onboarding / first-run
  CompanyCreateStart: "company_create_start", // /start mounted
  CompanyCreated: "company_created", // root agent persisted

  // Primitive activation — first-time use is the real product signal
  AgentCreated: "agent_created",
  QuestCreated: "quest_created",
  IdeaCreated: "idea_created",
  EventCreated: "event_created",

  // Engagement
  SessionMessageSent: "session_message_sent",
  CtaClick: "cta_click",

  // Consent / errors / drop-off proxies
  ConsentGranted: "consent_granted",
  ConsentRevoked: "consent_revoked",
  ErrorSeen: "error_seen", // surface-level error rendered to user
} as const;

export type EventName = (typeof Events)[keyof typeof Events] | (string & {});
