import type { RoleType } from "@/lib/types";

export const ROLE_TYPE_OPTIONS: { value: RoleType; label: string; desc: string }[] = [
  { value: "director", label: "Director", desc: "Full authority by default" },
  { value: "operational", label: "Operator", desc: "Day-to-day execution" },
  { value: "advisor", label: "Advisor", desc: "Read-only advisory access" },
];
