import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useNav } from "@/hooks/useNav";
import { useDaemonStore } from "@/store/daemon";
import { entityPathFromId } from "@/lib/entityPath";
import { type EntityPrimitive, type EntityRef } from "./types";

const TAB_BY_PRIMITIVE: Record<EntityPrimitive, string> = {
  agent: "agents",
  quest: "quests",
  idea: "ideas",
  event: "events",
};

const LABEL_BY_PRIMITIVE: Record<EntityPrimitive, string> = {
  agent: "Agent",
  quest: "Quest",
  idea: "Idea",
  event: "Event",
};

/**
 * Inline mention for an aeqi primitive. Canonical refs provide `kind + id`;
 * label-only parser fallbacks resolve opportunistically from local state.
 */
export default function EntityRefInline({ ref }: { ref: EntityRef }) {
  const { companyId: routeCompanyId } = useNav();
  const entities = useDaemonStore((s) => s.entities);
  const agents = useDaemonStore((s) => s.agents);
  const quests = useDaemonStore((s) => s.quests);

  const resolved = useMemo(() => {
    if (ref.id) return ref.id;
    const lc = (ref.label ?? ref.slug ?? "").trim().toLowerCase();
    if (!lc) return "";
    if (ref.kind === "agent") {
      return agents.find((a) => (a.name ?? "").toLowerCase() === lc)?.id ?? "";
    }
    if (ref.kind === "quest") {
      return (
        quests.find((q) => q.id.toLowerCase() === lc || (q.idea?.name ?? "").toLowerCase() === lc)
          ?.id ?? ""
      );
    }
    return "";
  }, [ref.id, ref.label, ref.slug, ref.kind, agents, quests]);

  const displayLabel = useMemo(() => {
    if (ref.label) return ref.label;
    if (ref.kind === "agent") return agents.find((a) => a.id === resolved)?.name ?? ref.slug;
    if (ref.kind === "quest") return quests.find((q) => q.id === resolved)?.idea?.name ?? ref.slug;
    return ref.slug || ref.id;
  }, [ref.label, ref.slug, ref.id, ref.kind, resolved, agents, quests]);

  const scopeCompanyId = ref.companyId || routeCompanyId;
  const role = LABEL_BY_PRIMITIVE[ref.kind];
  const body = (
    <>
      <span className="asv-entity-ref-kind">{role}</span>
      <span className="asv-entity-ref-label">{displayLabel || role}</span>
      {ref.status && <span className="asv-entity-ref-status">{ref.status}</span>}
    </>
  );

  if (!scopeCompanyId || !resolved) {
    return (
      <span
        className={`asv-entity-ref asv-entity-ref--${ref.kind} asv-entity-ref--unresolved`}
        title={`${role}: ${displayLabel || "unresolved"}`}
      >
        {body}
      </span>
    );
  }

  const href = entityPathFromId(
    entities,
    scopeCompanyId,
    TAB_BY_PRIMITIVE[ref.kind],
    encodeURIComponent(resolved),
  );
  return (
    <Link
      to={href}
      className={`asv-entity-ref asv-entity-ref--${ref.kind}`}
      title={`${role}: ${displayLabel || resolved}${ref.status ? ` (${ref.status})` : ""}`}
    >
      {body}
    </Link>
  );
}
