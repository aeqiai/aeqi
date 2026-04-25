/** Relative time string from an ISO timestamp — long form for prose
 *  rendering (`5m ago` / `3h ago`). Use `timeShort` for tight UI columns. */
export function timeAgo(iso: string | undefined | null): string {
  if (!iso) return "";
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 0) return "now";
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** Compact relative time for tight UI columns (inbox rows, sessions rail).
 *  No "ago" suffix — just the unit. Falls back to a short date once the
 *  age exceeds a week. Designed to fit a tabular-num column at ~3ch. */
export function timeShort(iso: string | undefined | null): string {
  if (!iso) return "";
  const target = new Date(iso).getTime();
  const ms = Date.now() - target;
  if (ms < 30_000) return "now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  // > 1 week — show short calendar date.
  return new Date(target).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Recency bucket label for inbox grouping (Things 3 / Linear style).
 *  Returns: "today", "yesterday", "earlier this week", "older". */
export type RecencyBucket = "today" | "yesterday" | "earlier this week" | "older";

export function recencyBucket(iso: string | undefined | null): RecencyBucket {
  if (!iso) return "older";
  const then = new Date(iso);
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const todayStart = startOfDay(now);
  const yesterdayStart = todayStart - 86_400_000;
  const weekStart = todayStart - 6 * 86_400_000; // last 7 calendar days incl. today
  const t = then.getTime();
  if (t >= todayStart) return "today";
  if (t >= yesterdayStart) return "yesterday";
  if (t >= weekStart) return "earlier this week";
  return "older";
}
