import { useNav } from "@/hooks/useNav";
import type { Idea } from "@/lib/types";

export function IdeaMention({
  name,
  ideasByName,
  agentId,
}: {
  name: string;
  ideasByName?: Map<string, Idea>;
  agentId?: string;
}) {
  const { goEntity } = useNav();
  const hit = ideasByName?.get(name.toLowerCase());
  const broken = !hit;

  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (hit && agentId) goEntity(agentId, "ideas", hit.id);
  };

  return (
    <button
      type="button"
      className={`idea-mention${broken ? " idea-mention-broken" : ""}`}
      onClick={onClick}
      title={broken ? `No idea named "${name}"` : hit!.name}
      disabled={broken}
    >
      {name}
    </button>
  );
}

export function IdeaEmbed({
  name,
  ideasByName,
  agentId,
}: {
  name: string;
  ideasByName?: Map<string, Idea>;
  agentId?: string;
}) {
  const { goEntity } = useNav();
  const hit = ideasByName?.get(name.toLowerCase());

  if (!hit) {
    return (
      <div className="idea-embed idea-embed-broken">
        <span className="idea-embed-title">{name}</span>
        <span className="idea-embed-note">Not found</span>
      </div>
    );
  }

  const preview = (hit.content ?? "")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .slice(0, 3)
    .join("\n");

  return (
    <div
      className="idea-embed"
      onClick={() => agentId && goEntity(agentId, "ideas", hit.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && agentId) {
          e.preventDefault();
          goEntity(agentId, "ideas", hit.id);
        }
      }}
    >
      <div className="idea-embed-head">
        <span className="idea-embed-title">{hit.name}</span>
        <span className="idea-embed-open">Open</span>
      </div>
      {preview && <div className="idea-embed-preview">{preview}</div>}
    </div>
  );
}
