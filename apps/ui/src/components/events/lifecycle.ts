import type { AgentEvent } from "@/lib/types";
import { formatShortDate } from "@/lib/i18n";

/**
 * Lifecycle bucket for an event pattern. Three groups, MVP-locked:
 *
 *   runtime    — session lifecycle, context budget, loop / guardrail
 *                detectors. The agent reasoning loop's own hooks.
 *   webhooks   — incoming HTTP from the outside world. Channel
 *                integrations (telegram, slack, …) live here too —
 *                logically they are webhooks.
 *   routines   — time-driven (cron). `schedule:CRON_EXPR`.
 *
 * Anything unrecognised falls into `runtime` for now — most stray
 * patterns are runtime-flavoured (e.g. shell:command_failed).
 */
export type LifecycleGroup = "runtime" | "webhooks" | "routines";

export const LIFECYCLE_ORDER: LifecycleGroup[] = ["runtime", "webhooks", "routines"];

export const LIFECYCLE_LABEL: Record<LifecycleGroup, string> = {
  runtime: "Runtime",
  webhooks: "Webhooks",
  routines: "Routines",
};

export const LIFECYCLE_HINT: Record<LifecycleGroup, string> = {
  runtime: "the agent's own loop · session, context, guardrails",
  webhooks: "incoming http · channels, integrations",
  routines: "scheduled · cron-driven runs",
};

const RUNTIME_PREFIXES = new Set([
  "session",
  "context",
  "loop",
  "guardrail",
  "graph_guardrail",
  "shell",
]);
const WEBHOOK_PREFIXES = new Set([
  "webhook",
  "http",
  "telegram",
  "slack",
  "discord",
  "stripe",
  "github",
]);
const ROUTINE_PREFIXES = new Set(["schedule", "cron"]);

export function lifecycleGroup(pattern: string): LifecycleGroup {
  const prefix = pattern.split(":")[0]?.toLowerCase() ?? "";
  if (WEBHOOK_PREFIXES.has(prefix)) return "webhooks";
  if (ROUTINE_PREFIXES.has(prefix)) return "routines";
  if (RUNTIME_PREFIXES.has(prefix)) return "runtime";
  return "runtime";
}

export function eventLifecycle(ev: AgentEvent): LifecycleGroup {
  return lifecycleGroup(ev.pattern);
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function cronExpression(pattern: string): string {
  if (pattern.startsWith("schedule:")) return pattern.slice("schedule:".length).trim();
  if (pattern.startsWith("cron:")) return pattern.slice("cron:".length).trim();
  return pattern.trim();
}

function cronTime(hour: string, minute: string): string {
  const h = Number.parseInt(hour, 10);
  const m = Number.parseInt(minute, 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return "";
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function cronMinute(minute: string): string {
  const m = Number.parseInt(minute, 10);
  if (!Number.isFinite(m) || String(m) !== minute || m < 0 || m > 59) return "";
  return `:${String(m).padStart(2, "0")}`;
}

function weekdayName(dayOfWeek: string): string {
  const weekday = Number.parseInt(dayOfWeek, 10);
  if (!Number.isFinite(weekday)) return `day ${dayOfWeek}`;
  return WEEKDAY_LABELS[weekday === 7 ? 0 : weekday] ?? `day ${dayOfWeek}`;
}

function routineCadence(cron: string): string | null {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = cron.split(/\s+/);
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) return null;

  if (minute === "*" && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return "every minute";
  }

  const minuteStep = minute.match(/^\*\/(\d+)$/);
  if (minuteStep && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    const interval = Number.parseInt(minuteStep[1], 10);
    return Number.isFinite(interval) ? `every ${interval}m` : null;
  }

  const minuteOfHour = cronMinute(minute);
  if (minuteOfHour && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `hourly at ${minuteOfHour}`;
  }

  const time = cronTime(hour, minute);
  if (!time) return null;
  if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*") return `daily ${time}`;

  if (dayOfMonth === "*" && month === "*" && dayOfWeek !== "*") {
    if (dayOfWeek === "1-5") return `weekdays ${time}`;
    if (dayOfWeek === "0,6" || dayOfWeek === "6,0" || dayOfWeek === "6,7") {
      return `weekends ${time}`;
    }
    return `weekly ${weekdayName(dayOfWeek)} ${time}`;
  }

  if (dayOfMonth !== "*" && month === "*" && dayOfWeek === "*") {
    return `monthly day ${dayOfMonth} ${time}`;
  }

  return null;
}

export function routineWhenLabel(pattern: string): string {
  const cron = cronExpression(pattern);
  if (!cron) return "cron schedule";
  const cadence = routineCadence(cron);
  return cadence ? `${cadence} · cron ${cron}` : `cron ${cron}`;
}

function fieldMatcher(raw: string, min: number, max: number): ((value: number) => boolean) | null {
  if (raw === "*") return () => true;

  const parts = raw.split(",");
  const matchers = parts.map((part) => {
    const step = part.match(/^\*\/(\d+)$/);
    if (step) {
      const interval = Number.parseInt(step[1], 10);
      if (!Number.isFinite(interval) || interval <= 0) return null;
      return (value: number) => value % interval === 0;
    }

    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) {
      const start = Number.parseInt(range[1], 10);
      const end = Number.parseInt(range[2], 10);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
      if (start < min || end > max || start > end) return null;
      return (value: number) => value >= start && value <= end;
    }

    if (!/^\d+$/.test(part)) return null;
    const exact = Number.parseInt(part, 10);
    if (!Number.isFinite(exact) || exact < min || exact > max) {
      return null;
    }
    return (value: number) => value === exact;
  });

  if (matchers.some((matcher) => matcher == null)) return null;
  return (value: number) => matchers.some((matcher) => matcher?.(value) === true);
}

function dayOfWeekForCron(date: Date): number {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

function cronMatches(date: Date, cron: string): boolean {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = cron.split(/\s+/);
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) return false;

  const matchMinute = fieldMatcher(minute, 0, 59);
  const matchHour = fieldMatcher(hour, 0, 23);
  const matchDayOfMonth = fieldMatcher(dayOfMonth, 1, 31);
  const matchMonth = fieldMatcher(month, 1, 12);
  const matchDayOfWeek = fieldMatcher(dayOfWeek, 0, 7);
  if (!matchMinute || !matchHour || !matchDayOfMonth || !matchMonth || !matchDayOfWeek) {
    return false;
  }

  return (
    matchMinute(date.getMinutes()) &&
    matchHour(date.getHours()) &&
    matchDayOfMonth(date.getDate()) &&
    matchMonth(date.getMonth() + 1) &&
    (matchDayOfWeek(date.getDay()) || matchDayOfWeek(dayOfWeekForCron(date)))
  );
}

function formatNextDate(date: Date, now: Date): string {
  const hhmm = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfCandidate = new Date(date);
  startOfCandidate.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((startOfCandidate.getTime() - startOfToday.getTime()) / 86_400_000);

  if (dayDiff === 0) return `today ${hhmm}`;
  if (dayDiff === 1) return `tomorrow ${hhmm}`;
  if (dayDiff > 1 && dayDiff < 7) return `${WEEKDAY_LABELS[date.getDay()]} ${hhmm}`;
  return `${formatShortDate(date)} ${hhmm}`;
}

export function routineNextLabel(pattern: string, now = new Date()): string | null {
  const cron = cronExpression(pattern);
  if (!cron) return null;

  const candidate = new Date(now);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const maxMinutes = 366 * 24 * 60;
  for (let i = 0; i < maxMinutes; i += 1) {
    if (cronMatches(candidate, cron)) return formatNextDate(candidate, now);
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  return null;
}
