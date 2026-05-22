import { CircleCheck, Inbox } from "lucide-react";

interface InboxEmptyCanvasProps {
  title: string;
  hint: string;
  kind: "empty" | "select";
  className?: string;
}

export default function InboxEmptyCanvas({ title, hint, kind, className }: InboxEmptyCanvasProps) {
  const EmptyIcon = kind === "empty" ? CircleCheck : Inbox;

  return (
    <div
      className={["inbox-empty-canvas", className ?? ""].filter(Boolean).join(" ")}
      role="status"
      aria-live="polite"
    >
      <EmptyIcon size={26} strokeWidth={1.5} className="inbox-empty-canvas-icon" />
      <p className="inbox-empty-canvas-title">{title}</p>
      <p className="inbox-empty-canvas-hint">{hint}</p>
    </div>
  );
}
