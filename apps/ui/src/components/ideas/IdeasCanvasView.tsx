import IdeaCanvas from "../IdeaCanvas";
import type { Idea } from "@/lib/types";

export interface IdeasCanvasViewProps {
  agentId: string;
  idea?: Idea;
  presetName: string;
  onBack: () => void;
  onNew: () => void;
}

export default function IdeasCanvasView({
  agentId,
  idea,
  presetName,
  onBack,
  onNew,
}: IdeasCanvasViewProps) {
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
        onBack={onBack}
        onNew={onNew}
      />
    </div>
  );
}
