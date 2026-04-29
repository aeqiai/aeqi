/**
 * Analytics consent storage. Single source of truth across the app and
 * the privacy/account screens. Browser-only — every accessor is guarded
 * so SSR-style imports don't blow up.
 */

const KEY = "aeqi-analytics-consent";
const EVENT = "aeqi-analytics-consent-changed";

export type ConsentLevel = "all" | "essential" | null;

export function readConsent(): ConsentLevel {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "all" || v === "essential" ? v : null;
  } catch {
    return null;
  }
}

export function writeConsent(level: ConsentLevel): void {
  if (typeof window === "undefined") return;
  try {
    if (level === null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, level);
  } catch {
    // storage unavailable — accept the no-op
  }
  window.dispatchEvent(new CustomEvent<ConsentLevel>(EVENT, { detail: level }));
}

export function onConsentChange(handler: (level: ConsentLevel) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => handler((e as CustomEvent<ConsentLevel>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
