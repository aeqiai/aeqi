/**
 * Analytics event tracking.
 *
 * In open source (self-hosted): no-op, no tracking script loaded.
 * In SaaS (app.aeqi.ai): platform injects Plausible, these calls work.
 *
 * This file is safe to ship in open source — it does nothing without
 * the Plausible script that only the platform injects.
 */
export function trackEvent(name: string, props?: Record<string, string | number | boolean>) {
  const w = window as any;
  if (typeof w.plausible === "function") {
    w.plausible(name, props ? { props } : undefined);
  }
}

export const events = {
  signup: (method: string) => trackEvent("Signup", { method }),
  login: (method: string) => trackEvent("Login", { method }),
  companyCreated: (name: string) => trackEvent("Company Created", { name }),
  checkoutStarted: (plan: string) => trackEvent("Checkout Started", { plan }),
  subscriptionActivated: (plan: string) => trackEvent("Subscription Activated", { plan }),
  upgradeClicked: () => trackEvent("Upgrade Clicked"),
  agentSpawned: (template: string) => trackEvent("Agent Spawned", { template }),
};
