import { useNav } from "@/hooks/useNav";
import { usePrimitiveResolver, type PrimitiveKind } from "@/hooks/usePrimitiveResolver";

// Kind → dot color class suffix, keeping design-system v4 tokens.
// agent=graphite(accent), event=jade(success), idea=amber(warning), quest=neutral.
const KIND_COLOR: Record<string, string> = {
  agent: "graphite",
  event: "jade",
  idea: "amber",
  quest: "neutral",
};

const KIND_LABEL: Record<string, string> = {
  agent: "AGENT",
  event: "EVENT",
  idea: "IDEA",
  quest: "QUEST",
};

function Skeleton() {
  return <span className="aeqi-ref aeqi-ref--skeleton" aria-hidden="true" />;
}

function NotFound({ id }: { id: string }) {
  return (
    <span className="aeqi-ref aeqi-ref--notfound" title={id}>
      not found
    </span>
  );
}

export function PrimitivePreview({ kind, id }: { kind: PrimitiveKind | null; id: string }) {
  const { goAgent, agentId } = useNav();
  const { data, loading, error } = usePrimitiveResolver(kind, id);

  if (loading) return <Skeleton />;
  if (error || !data) return <NotFound id={id} />;

  const colorKey = KIND_COLOR[data.kind] ?? "neutral";
  const label = KIND_LABEL[data.kind] ?? data.kind.toUpperCase();

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (data.kind === "agent") {
      goAgent(data.id);
      return;
    }

    const targetAgentId = agentId || data.agent_id || "";
    if (!targetAgentId) {
      return;
    }

    if (data.kind === "event") {
      goAgent(targetAgentId, "events", data.id);
    } else if (data.kind === "idea") {
      goAgent(targetAgentId, "ideas", data.id);
    } else if (data.kind === "quest") {
      goAgent(targetAgentId, "quests", data.id);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick(e as unknown as React.MouseEvent);
    }
  };

  return (
    <span
      className={`aeqi-ref aeqi-ref--${data.kind} aeqi-ref--color-${colorKey}`}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      title={`${label} · ${data.id}`}
    >
      <span className={`aeqi-ref-dot aeqi-ref-dot--${colorKey}`} aria-hidden="true" />
      <span className="aeqi-ref-kind">{label}</span>
      <span className="aeqi-ref-name">{data.name}</span>
      {data.kind === "event" && <span className="aeqi-ref-sub">{data.pattern}</span>}
      {data.kind === "quest" && (
        <span className={`aeqi-ref-pill aeqi-ref-pill--${data.status}`}>{data.status}</span>
      )}
      {data.kind === "idea" && data.tags.length > 0 && (
        <span className="aeqi-ref-tags">
          {data.tags.slice(0, 2).map((t) => (
            <span key={t} className="aeqi-ref-tag">
              {t}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
