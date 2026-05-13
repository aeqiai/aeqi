import { formatShortDate } from "./i18n";

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
  return formatShortDate(target);
}

/** Linear-style due-date relative label. Returns:
 *   - past: "overdue 2d", "overdue 3h"
 *   - within an hour: "in 12m"
 *   - same day: "today"
 *   - tomorrow: "tomorrow"
 *   - within a week: "in 3d"
 *   - further: short calendar date (`May 14`)
 *   Empty string when iso is missing. The chip render layer uses
 *   `isOverdue()` to decide red-tinting; this function returns a label
 *   that naturally drops the "overdue" prefix once the date is in the
 *   future or the same day. */
export function dueLabel(iso: string | undefined | null): string {
  if (!iso) return "";
  const target = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = target - now;
  // Day-aligned comparisons — "today" should win even if `due_at` is set
  // to 23:59 (bare-date semantics) and `now` is 00:01 the next morning.
  const startOfDay = (t: number) => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const todayStart = startOfDay(now);
  const targetStart = startOfDay(target);
  const dayDelta = Math.round((targetStart - todayStart) / 86_400_000);

  if (diffMs < 0) {
    // Overdue path. Use day-delta when the miss is older than today,
    // hours when within today.
    if (dayDelta < 0) return `overdue ${Math.abs(dayDelta)}d`;
    const hoursLate = Math.floor(-diffMs / 3_600_000);
    if (hoursLate >= 1) return `overdue ${hoursLate}h`;
    const minutesLate = Math.floor(-diffMs / 60_000);
    return `overdue ${Math.max(minutesLate, 1)}m`;
  }
  if (dayDelta === 0) {
    if (diffMs < 60 * 60_000) {
      const m = Math.max(Math.floor(diffMs / 60_000), 1);
      return `in ${m}m`;
    }
    if (diffMs < 24 * 60 * 60_000) {
      const h = Math.floor(diffMs / 3_600_000);
      return h <= 1 ? `in 1h` : `in ${h}h`;
    }
    return "today";
  }
  if (dayDelta === 1) return "tomorrow";
  if (dayDelta < 7) return `in ${dayDelta}d`;
  return formatShortDate(target);
}

/** True iff the due-date is strictly in the past. Used by chip renderers
 * to decide on the red-tint variant. Returns false when iso is missing. */
export function isOverdue(iso: string | undefined | null): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() < Date.now();
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
