/**
 * Rate-limit state — module-level singleton shared between the fetch
 * wrapper and the UI.
 *
 * When the API returns 429, `api.ts` parses `Retry-After` and calls
 * `setRateLimitedUntil()` with a future timestamp (ms).  Consumers read
 * via `getRateLimitedUntil()` or, in React, subscribe with
 * `useRateLimitedUntil()` (re-renders when the value changes).
 *
 * Kept outside the Zustand store because `api.ts` must not import stores
 * (stores import `api`, so the reverse would be a cycle).  The hook uses
 * `useSyncExternalStore` so Zustand's DevTools-ish ergonomics don't bleed
 * in — it's one number, no need for a full store.
 */
import { useSyncExternalStore } from "react";

const EVENT = "aeqi:rate-limit-change";

let rateLimitedUntil: number | null = null;

export function getRateLimitedUntil(): number | null {
  return rateLimitedUntil;
}

export function setRateLimitedUntil(tsMs: number | null): void {
  if (tsMs === rateLimitedUntil) return;
  rateLimitedUntil = tsMs;
  window.dispatchEvent(new Event(EVENT));
}

export function isRateLimited(now: number = Date.now()): boolean {
  return rateLimitedUntil !== null && rateLimitedUntil > now;
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

/** React hook: re-renders when the rate-limit state changes. */
export function useRateLimitedUntil(): number | null {
  return useSyncExternalStore(subscribe, getRateLimitedUntil, () => null);
}
