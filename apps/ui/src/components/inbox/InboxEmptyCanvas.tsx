import { CircleCheck, Inbox } from "lucide-react";

interface InboxEmptyCanvasProps {
  title: string;
  hint: string;
  kind: "empty" | "select";
}

export default function InboxEmptyCanvas({ title, hint, kind }: InboxEmptyCanvasProps) {
  const EmptyIcon = kind === "empty" ? CircleCheck : Inbox;

  return (
    <div className="inbox-empty-canvas" role="status" aria-live="polite">
      <EmptyIcon size={26} strokeWidth={1.5} className="inbox-empty-canvas-icon" />
      <p className="inbox-empty-canvas-title">{title}</p>
      <p className="inbox-empty-canvas-hint">{hint}</p>
    </div>
  );
}
