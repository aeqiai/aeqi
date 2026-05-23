import { processRawSessionMessages } from "@/components/session/useMessageProcessor";
import type { Message } from "@/components/session/types";

interface RawApiMessage {
  id?: number;
  role?: string;
  content?: string;
  created_at?: string;
  source?: string | null;
  event_type?: string | null;
  metadata?: Record<string, unknown> | null;
  from_kind?: string | null;
  from_id?: string | null;
}

/**
 * Map the inbox API's raw message shape to the canonical session `Message`
 * type so the SessionDetail/MessageItem render path is identical to the
 * agent surface. `from_kind` / `from_id` come straight from the IPC row
 * — do NOT synthesise from `role`. Cron / schedule prompts ship as
 * `from_kind === "system"` and must NOT be attributed to the viewing
 * user; synthesising `role === "user"` → `from_kind: "user"` is the bug
 * that makes cron rows render with the founder's name.
 */
export function inboxMessagesAdapter(raw: Record<string, unknown>, agentName?: string): Message[] {
  const items = Array.isArray(raw.messages) ? (raw.messages as RawApiMessage[]) : [];
  const normalized = items.map((item) => ({
    ...item,
    role: typeof item.role === "string" ? item.role.toLowerCase() : item.role,
  }));
  const messages = processRawSessionMessages(
    normalized as unknown as Array<Record<string, unknown>>,
  );
  if (!agentName) return messages;
  return messages.map((message) =>
    message.role === "assistant" && message.source === "question.ask" && !message.askSubject
      ? { ...message, askSubject: agentName }
      : message,
  );
}
