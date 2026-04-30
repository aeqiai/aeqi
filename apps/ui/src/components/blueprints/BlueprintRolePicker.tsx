import { useMemo } from "react";
import type { Blueprint, RoleOverride, RoleOverrideOccupant } from "@/lib/types";
import { Select } from "@/components/ui";

interface BlueprintRolePickerProps {
  template: Blueprint;
  /** Current operator's user_id, surfaced as the "Me" occupant option.
   *  When null, the human variant is hidden. */
  userId: string | null;
  /** Lookup of role_key → operator override. Keys not present here
   *  use the template's `default_occupant_agent`. */
  overrides: Record<string, RoleOverrideOccupant>;
  onChange: (next: Record<string, RoleOverrideOccupant>) => void;
}

/**
 * Pre-spawn occupant picker for a Blueprint's declared roles.
 *
 * Each declared role surfaces three choices:
 *   - default agent (the seeded `default_occupant_agent`)
 *   - me (slot the current user as a human occupant)
 *   - vacant (leave the role empty for later hiring)
 *
 * The picker only renders when the template declares `seed_roles`.
 * On launch, the parent page packages the resolved overrides into the
 * `spawnBlueprint` payload — the orchestrator's
 * `install_declared_roles` honors them when materializing positions.
 */
export function BlueprintRolePicker({
  template,
  userId,
  overrides,
  onChange,
}: BlueprintRolePickerProps) {
  const roles = useMemo(() => template.seed_roles ?? [], [template.seed_roles]);

  if (roles.length === 0) return null;

  const setOccupant = (key: string, occupant: RoleOverrideOccupant) => {
    onChange({ ...overrides, [key]: occupant });
  };

  return (
    <section className="bp-role-picker" aria-label="Configure occupants for each role">
      <header className="bp-role-picker-head">
        <h2 className="bp-role-picker-title">Team setup</h2>
        <p className="bp-role-picker-sub">
          Each role ships with a default agent. Swap any for yourself, or leave vacant to hire
          later.
        </p>
      </header>
      <ul className="bp-role-picker-list" role="list">
        {roles.map((role) => {
          const current = overrides[role.key] ?? defaultOccupantFor(role.default_occupant_agent);
          const value = encodeOccupant(current);
          const options = buildOptions(role.default_occupant_agent, !!userId);
          return (
            <li key={role.key} className="bp-role-picker-row">
              <span className="bp-role-picker-row-title">{role.title}</span>
              <Select
                value={value}
                options={options}
                onChange={(v) => {
                  const next = decodeOccupant(v, role.default_occupant_agent, userId);
                  if (next) setOccupant(role.key, next);
                }}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Compact the picker's choice into the RoleOverride payload. Keys
 *  whose effective occupant matches the template default are dropped
 *  (the wire stays lean — server falls back to the template default
 *  when no override is supplied for a role). */
export function buildRoleOverridesPayload(
  template: Blueprint,
  overrides: Record<string, RoleOverrideOccupant>,
): RoleOverride[] {
  const roles = template.seed_roles ?? [];
  const out: RoleOverride[] = [];
  for (const role of roles) {
    const choice = overrides[role.key];
    if (!choice) continue;
    if (occupantsEqual(choice, defaultOccupantFor(role.default_occupant_agent))) continue;
    out.push({ role_key: role.key, occupant: choice });
  }
  return out;
}

function defaultOccupantFor(agent: string | null | undefined): RoleOverrideOccupant {
  if (!agent) return { kind: "vacant" };
  return { kind: "agent", agent };
}

function occupantsEqual(a: RoleOverrideOccupant, b: RoleOverrideOccupant): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "agent" && b.kind === "agent") return a.agent === b.agent;
  if (a.kind === "human" && b.kind === "human") return a.user_id === b.user_id;
  return true; // both vacant
}

function buildOptions(
  defaultAgent: string | null | undefined,
  hasUser: boolean,
): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = [];
  if (defaultAgent) {
    opts.push({ value: `agent:${defaultAgent}`, label: defaultAgent });
  }
  if (hasUser) opts.push({ value: "me", label: "Me (human)" });
  opts.push({ value: "vacant", label: "Vacant" });
  return opts;
}

function encodeOccupant(o: RoleOverrideOccupant): string {
  if (o.kind === "agent") return `agent:${o.agent}`;
  if (o.kind === "human") return "me";
  return "vacant";
}

function decodeOccupant(
  value: string,
  defaultAgent: string | null | undefined,
  userId: string | null,
): RoleOverrideOccupant | null {
  if (value === "vacant") return { kind: "vacant" };
  if (value === "me") {
    if (!userId) return null;
    return { kind: "human", user_id: userId };
  }
  if (value.startsWith("agent:")) return { kind: "agent", agent: value.slice("agent:".length) };
  // Default fallback — should never hit here since every option encodes
  // through the helpers, but keep the path safe.
  return defaultOccupantFor(defaultAgent);
}
