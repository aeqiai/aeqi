import IdeaCanvas from "../IdeaCanvas";
import { useCallback, useState } from "react";
import type { Idea } from "@/lib/types";
import { useNav } from "@/hooks/useNav";
import TrackIdeaAsQuestModal from "../quests/TrackIdeaAsQuestModal";

export interface IdeasCanvasViewProps {
  agentId: string;
  idea?: Idea;
  presetName: string;
  parentIdeaId?: string | null;
  onBack: () => void;
  onNew: () => void;
}

export default function IdeasCanvasView({
  agentId,
  idea,
  presetName,
  parentIdeaId,
  onBack,
  onNew,
}: IdeasCanvasViewProps) {
  const { goEntity, trustId } = useNav();
  const [trackIdea, setTrackIdea] = useState<Idea | null>(null);
  const handleTrackedQuestCreated = useCallback(
    async (quest: { id: string }) => {
      setTrackIdea(null);
      goEntity(trustId, "quests", quest.id);
    },
    [goEntity, trustId],
  );

  return (
    <div className="ideas-detail-wrap">
      {/* Keying on the id resets internal canvas state when switching ideas —
          cheaper than threading reset logic through refs. The canvas owns
          its own header now (back / scope / save / new / kebab), so this
          wrapper is just the keyed mount point. */}
      <IdeaCanvas
        key={idea?.id ?? "compose"}
        agentId={agentId}
        idea={idea}
        initialName={presetName}
        parentIdeaId={parentIdeaId}
        onBack={onBack}
        onNew={onNew}
        onTrackAsQuest={setTrackIdea}
      />
      <TrackIdeaAsQuestModal
        open={Boolean(trackIdea)}
        idea={trackIdea}
        agentId={agentId}
        trustId={trustId}
        onClose={() => setTrackIdea(null)}
        onCreated={handleTrackedQuestCreated}
      />
    </div>
  );
}
