import {
  questIdFromMeta,
  questIdFromText,
  questSnapshotFromMeta,
  type Message,
} from "@/components/session/types";

interface RawApiMessage {
  role?: string;
  content?: string;
  created_at?: string;
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
  const result: Message[] = [];
  for (const m of items) {
    const role = typeof m.role === "string" ? m.role.toLowerCase() : "";
    const eventType = typeof m.event_type === "string" ? m.event_type : "message";
    const meta = m.metadata && typeof m.metadata === "object" ? m.metadata : {};
    const content = typeof m.content === "string" ? m.content : "";
    const ts = m.created_at ? new Date(String(m.created_at)).getTime() : Date.now();
    if (role === "quest_event" || eventType.startsWith("quest_")) {
      const quest = questSnapshotFromMeta(meta);
      result.push({
        role: "quest_event",
        content: content || quest.subject || eventType.replace(/_/g, " "),
        timestamp: ts,
        eventType,
        taskId: quest.id ?? questIdFromMeta(meta) ?? questIdFromText(content),
        quest,
      });
      continue;
    }
    if (role !== "user" && role !== "assistant" && role !== "system") continue;
    if (!content.trim()) continue;
    const rawFromKind = typeof m.from_kind === "string" ? m.from_kind : null;
    let from_kind: Message["from_kind"];
    if (rawFromKind === "user" || rawFromKind === "agent" || rawFromKind === "system") {
      from_kind = rawFromKind;
    } else if (rawFromKind === "position") {
      from_kind = "position";
    } else if (role === "system") {
      from_kind = "system";
    } else if (role === "assistant") {
      from_kind = "agent";
    } else {
      from_kind = "user";
    }
    const from_id = typeof m.from_id === "string" ? m.from_id : null;
    result.push({
      role,
      from_kind,
      from_id,
      content,
      timestamp: ts,
      ...(role === "assistant" && agentName ? { askSubject: agentName } : {}),
    });
  }
  return result;
}
