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
  runtime: "runtime",
  webhooks: "webhooks",
  routines: "routines",
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
