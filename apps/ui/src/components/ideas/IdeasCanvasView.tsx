import IdeaCanvas from "../IdeaCanvas";
import { IdeasDetailBackBar } from "./IdeasPrimitiveHead";
import type { Idea } from "@/lib/types";

export interface IdeasCanvasViewProps {
  agentId: string;
  idea?: Idea;
  composing: boolean;
  presetName: string;
  onBack: () => void;
  onNew: () => void;
}

export default function IdeasCanvasView({
  agentId,
  idea,
  composing,
  presetName,
  onBack,
  onNew,
}: IdeasCanvasViewProps) {
  return (
    <div className="ideas-detail-wrap">
      <IdeasDetailBackBar onBack={onBack} onNew={onNew} showNew={!composing} />
      {/* Keying on the id resets internal canvas state when switching ideas —
          cheaper than threading reset logic through refs. */}
      <IdeaCanvas
        key={idea?.id ?? "compose"}
        agentId={agentId}
        idea={idea}
        initialName={presetName}
      />
    </div>
  );
}
