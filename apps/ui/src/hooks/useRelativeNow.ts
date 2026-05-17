import { useEffect, useState } from "react";

const TICK_INTERVAL_MS = 60_000;

const listeners = new Set<() => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;

function ensureInterval() {
  if (intervalId !== null) return;
  intervalId = setInterval(() => {
    listeners.forEach((fn) => fn());
  }, TICK_INTERVAL_MS);
}

function maybeStopInterval() {
  if (intervalId !== null && listeners.size === 0) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

/**
 * Subscribes the calling component to a single shared 60 s tick so
 * relative-time labels (`timeAgo`, `formatRelative`, …) advance even
 * when the underlying data hasn't changed. Without this hook a "2m ago"
 * badge stays "2m ago" forever in any pane that isn't constantly
 * re-rendering — the labels silently lie about freshness.
 *
 * One `setInterval` runs app-wide regardless of how many consumers
 * subscribe; it starts on the first mount and stops when the last
 * consumer unmounts.
 *
 * Most callers ignore the return value and use the hook for its
 * re-render side-effect; the current epoch ms is returned for callers
 * that want to thread `now` through a memoised computation.
 */
export function useRelativeNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    listeners.add(tick);
    ensureInterval();
    return () => {
      listeners.delete(tick);
      maybeStopInterval();
    };
  }, []);
  return now;
}
