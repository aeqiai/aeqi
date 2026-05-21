import type { AgentEvent } from "@/lib/types";

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
  return pattern.startsWith("schedule:")
    ? pattern.slice("schedule:".length).trim()
    : pattern.trim();
}

function cronTime(hour: string, minute: string): string {
  const h = Number.parseInt(hour, 10);
  const m = Number.parseInt(minute, 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return "";
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
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

  const time = cronTime(hour, minute);
  if (!time) return null;
  if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*") return `daily ${time}`;

  if (dayOfMonth === "*" && month === "*" && dayOfWeek !== "*") {
    const weekday = Number.parseInt(dayOfWeek, 10);
    const label = WEEKDAY_LABELS[weekday] ?? `day ${dayOfWeek}`;
    return `weekly ${label} ${time}`;
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
