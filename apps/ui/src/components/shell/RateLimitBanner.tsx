import { useEffect, useState } from "react";
import { useRateLimitedUntil, setRateLimitedUntil } from "@/lib/rateLimit";

/**
 * Quiet strip shown above the shell footer when the API rate-limited us.
 * Reads the singleton timestamp set by the fetch wrapper and ticks down a
 * countdown once per second.  Auto-dismisses when the deadline passes.
 *
 * The banner is a status surface, not an interaction — no close button.
 * Polling has already been paused centrally (see AppLayout's fetchAll
 * interval), so the user sees a steady "we'll resume in Xs" rather than
 * a stream of red errors.
 */
export default function RateLimitBanner() {
  const until = useRateLimitedUntil();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!until) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [until]);

  useEffect(() => {
    if (until && now >= until) setRateLimitedUntil(null);
  }, [now, until]);

  if (!until || now >= until) return null;

  const remaining = Math.max(1, Math.ceil((until - now) / 1000));

  return (
    <div className="shell-rate-limit" role="status" aria-live="polite">
      <span className="shell-rate-limit-dot" aria-hidden="true" />
      <span>
        Slowing down — we'll resume in <strong>{remaining}s</strong>
      </span>
    </div>
  );
}
