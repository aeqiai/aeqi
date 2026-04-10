import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Markdown from "react-markdown";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import RoundAvatar from "./RoundAvatar";

// ── Types ──

interface ToolEvent {
  type: "start" | "complete" | "turn" | "status";
  name: string;
  success?: boolean;
  input_preview?: string;
  output_preview?: string;
  duration_ms?: number;
  timestamp: number;
}

type MessageSegment =
  | { kind: "text"; text: string }
  | { kind: "tool"; event: ToolEvent }
  | { kind: "status"; text: string };

interface Message {
  role: string;
  content: string;
  segments?: MessageSegment[];
  timestamp?: number;
  duration?: string;
  toolEvents?: ToolEvent[];
  costUsd?: number;
  tokenUsage?: { prompt: number; completion: number };
  eventType?: string;
  taskId?: string;
}

// ── Helpers ──

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDuration(startMs: number, endMs: number): string {
  const diff = endMs - startMs;
  if (diff < 1000) return "<1s";
  if (diff < 60000) return `${Math.round(diff / 1000)}s`;
  return `${Math.floor(diff / 60000)}m ${Math.round((diff % 60000) / 1000)}s`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Tool display helpers ──

const TOOL_LABELS: Record<string, string> = {
  // Agents
  agents_hire: "Hire agent",
  agents_retire: "Retire agent",
  agents_list: "List agents",
  agents_delegate: "Delegate",
  // Quests
  quests_create: "Create quest",
  quests_update: "Update quest",
  quests_close: "Close quest",
  quests_cancel: "Cancel quest",
  quests_show: "View quest",
  quests_ready: "Ready quest",
  quests_prioritize: "Prioritize",
  quests_depend: "Set dependency",
  // Events
  events_create: "Create trigger",
  events_list: "List triggers",
  events_remove: "Remove trigger",
  events_manage: "Manage triggers",
  // Insights
  insights_store: "Store insight",
  insights_recall: "Recall insight",
  insights_graph: "Query graph",
  insights_search: "Search transcripts",
  // Prompts
  prompts_list: "List prompts",
  prompts_load: "Load prompt",
  prompts_search: "Search prompts",
  // Notes
  notes: "Note",
  // Files
  read_file: "Read file",
  write_file: "Write file",
  edit_file: "Edit file",
  list_dir: "List directory",
  glob: "Find files",
  grep: "Search code",
  // System
  shell: "Run command",
  execute_plan: "Execute plan",
  web_search: "Web search",
  web_fetch: "Fetch URL",
  git_worktree: "Git worktree",
  usage_stats: "Usage stats",
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name] || name.replace(/_/g, " ");
}

function toolCategoryIcon(toolName: string): string {
  if (toolName.startsWith("agents_")) return "◉";
  if (toolName.startsWith("quests_")) return "☰";
  if (toolName.startsWith("events_")) return "⊞";
  if (toolName.startsWith("insights_")) return "✦";
  if (toolName.startsWith("prompts_")) return "⚡";
  if (toolName.startsWith("notes")) return "✎";
  if (["shell", "read_file", "write_file", "edit_file", "glob", "grep", "list_dir", "execute_plan"].includes(toolName)) return "›";
  if (toolName.startsWith("web_")) return "↗";
  if (toolName === "git_worktree") return "⑂";
  return "·";
}

function toolCategoryClass(toolName: string): string {
  if (toolName.startsWith("agents_")) return "cat-agents";
  if (toolName.startsWith("quests_")) return "cat-quests";
  if (toolName.startsWith("events_")) return "cat-events";
  if (toolName.startsWith("insights_")) return "cat-insights";
  if (toolName.startsWith("prompts_")) return "cat-prompts";
  return "cat-util";
}

// ── Sub-components ──

function ExpandableOutput({
  text,
  limit = 100,
}: {
  text: string;
  limit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const needsExpand = text.length > limit;
  return (
    <div className="session-tool-output">
      {expanded || !needsExpand ? text : text.slice(0, limit) + "..."}
      {needsExpand && (
        <span
          className="session-tool-expand"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
        >
          {expanded ? "less" : "more"}
        </span>
      )}
    </div>
  );
}

/** A single collapsible tool block with its own expand state. */
function ToolBlock({ items }: { items: MessageSegment[] }) {
  const [expanded, setExpanded] = useState(false);
  const tools = items.filter((s): s is { kind: "tool"; event: ToolEvent } => s.kind === "tool");
  const count = tools.length;
  const cats = [...new Set(tools.map((t) => toolCategoryIcon(t.event.name)))];

  return (
    <div className="asv-tools-group">
      <button className="asv-tools-toggle" onClick={() => setExpanded(!expanded)}>
        <span className="asv-tools-toggle-icon">{expanded ? "▾" : "▸"}</span>
        {cats.join(" ")} {count} tool{count !== 1 ? "s" : ""}
      </button>
      {expanded && (
        <div className="asv-tools-expanded">
          {items.map((seg, si) =>
            seg.kind === "tool" ? (
              <div key={si} className={`asv-tool-inline ${seg.event.type} ${toolCategoryClass(seg.event.name)}`}>
                <span className={`asv-tool-icon ${toolCategoryClass(seg.event.name)}`}>
                  {toolCategoryIcon(seg.event.name)}
                </span>
                <span className="asv-tool-name">{toolLabel(seg.event.name)}</span>
                {seg.event.duration_ms != null && (
                  <span className="asv-tool-ms">{formatMs(seg.event.duration_ms)}</span>
                )}
                {seg.event.output_preview && (
                  <ExpandableOutput text={seg.event.output_preview} />
                )}
              </div>
            ) : seg.kind === "status" ? (
              <div key={si} className="asv-status-item">{seg.text}</div>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}

/** Renders segments, grouping consecutive tool/status items into collapsible blocks. */
function SegmentRenderer({ segments }: { segments: MessageSegment[] }) {
  type SegGroup =
    | { kind: "text"; text: string }
    | { kind: "turn"; text: string }
    | { kind: "tools"; items: MessageSegment[] };
  const groups: SegGroup[] = [];
  for (const seg of segments) {
    if (seg.kind === "text") {
      groups.push({ kind: "text", text: seg.text });
    } else if (seg.kind === "status" && seg.text.startsWith("Turn ")) {
      groups.push({ kind: "turn", text: seg.text });
    } else {
      const last = groups[groups.length - 1];
      if (last && last.kind === "tools") {
        last.items.push(seg);
      } else {
        groups.push({ kind: "tools", items: [seg] });
      }
    }
  }

  return (
    <>
      {groups.map((group, gi) =>
        group.kind === "text" ? (
          <div key={gi} className="asv-msg-content">
            <Markdown>{group.text}</Markdown>
          </div>
        ) : group.kind === "turn" ? (
          <div key={gi} className="asv-turn-sep">
            <span className="asv-turn-label">{group.text}</span>
          </div>
        ) : (
          <ToolBlock key={gi} items={group.items} />
        ),
      )}
    </>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      className="session-msg-copy"
      onClick={handleCopy}
      title={copied ? "Copied" : "Copy"}
    >
      {copied ? (
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 8.5l3 3 7-7" />
        </svg>
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="5" y="5" width="9" height="9" rx="2" />
          <path d="M5 11H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

function ThinkingStatus({ toolName }: { toolName?: string }) {
  if (toolName)
    return <div className="session-msg-thinking">{toolName}...</div>;
  return <div className="session-msg-thinking">thinking...</div>;
}

function ThinkingTimer({ start }: { start: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setElapsed(Date.now() - start), 100);
    return () => clearInterval(interval);
  }, [start]);
  return (
    <span className="session-msg-duration">
      {formatDuration(start, start + elapsed)}
    </span>
  );
}

// ── Main Component ──

interface SessionInfo {
  id: string;
  agent_id?: string;
  agent_name?: string;
  status: string;
  created_at: string;
  last_active?: string;
  message_count?: number;
  first_message?: string;
}

interface AgentSessionProps {
  agentId: string;
  sessionId: string | null;
}

export default function AgentSessionView({
  agentId,
  sessionId: urlSessionId,
}: AgentSessionProps) {
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const wsConnected = useDaemonStore((s) => s.wsConnected);
  const agents = useDaemonStore((s) => s.agents);

  // Resolve agent info from the store
  const agentInfo = agents.find(
    (a) => a.id === agentId || a.name === agentId,
  );
  const agentName = agentInfo?.name || agentId;
  const displayName = agentInfo?.display_name || agentName;

  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [showSessionList, setShowSessionList] = useState(false);

  // The active session comes from the URL
  const activeSessionId = urlSessionId;

  // Navigate helpers
  const setSession = useCallback(
    (sid: string | null) => {
      if (sid) {
        navigate(
          `/?agent=${encodeURIComponent(agentId)}&session=${encodeURIComponent(sid)}`,
          { replace: true },
        );
      } else {
        navigate(`/?agent=${encodeURIComponent(agentId)}`, { replace: true });
      }
    },
    [agentId, navigate],
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sessionPrompts, setSessionPrompts] = useState<string[]>([]);
  const [sessionTask, setSessionTask] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [showAttachPicker, setShowAttachPicker] = useState<
    "prompt" | "quest" | null
  >(null);
  const [attachSearch, setAttachSearch] = useState("");
  const [availablePrompts, setAvailablePrompts] = useState<
    { name: string; description: string; tags: string[] }[]
  >([]);
  const [availableTasks, setAvailableTasks] = useState<
    { id: string; name: string; status: string }[]
  >([]);
  const [attachedFiles, setAttachedFiles] = useState<
    { name: string; content: string; size: number }[]
  >([]);
  const [dragOver, setDragOver] = useState(false);
  const [activeTagFilters, setActiveTagFilters] = useState<string[]>([]);
  const [hoveredPrompt, setHoveredPrompt] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [liveToolEvents, setLiveToolEvents] = useState<ToolEvent[]>([]);
  const [liveSegments, setLiveSegments] = useState<MessageSegment[]>([]);
  const [thinkingStart, setThinkingStart] = useState<number | null>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Fetch available prompts and quests when picker opens
  useEffect(() => {
    if (showAttachPicker === "prompt" && availablePrompts.length === 0) {
      api
        .getSkills()
        .then((data: Record<string, unknown>) => {
          const items = (data?.skills || data?.prompts || []) as Array<Record<string, unknown>>;
          setAvailablePrompts(
            items.map((s) => ({
              name: (s.name as string) || "",
              description: (s.description as string) || "",
              tags: (s.tags as string[]) || [],
            })),
          );
        })
        .catch(() => {});
    }
    if (showAttachPicker === "quest" && availableTasks.length === 0) {
      api
        .getTasks({ status: "open" })
        .then((data: Record<string, unknown>) => {
          const items = (data?.tasks || data?.quests || []) as Array<Record<string, unknown>>;
          setAvailableTasks(
            items.map((t) => ({
              id: (t.id as string) || "",
              name: (t.name as string) || (t.subject as string) || "",
              status: (t.status as string) || "open",
            })),
          );
        })
        .catch(() => {});
    }
  }, [showAttachPicker]);

  // File attachment helpers
  const readFiles = useCallback((files: FileList | File[]) => {
    Array.from(files).forEach((file) => {
      if (file.size > 512_000) return; // 512KB limit
      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result as string;
        setAttachedFiles((prev) => {
          if (prev.some((f) => f.name === file.name)) return prev;
          return [...prev, { name: file.name, content, size: file.size }];
        });
      };
      reader.readAsText(file);
    });
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setDragOver(false);
      if (e.dataTransfer.files.length > 0) readFiles(e.dataTransfer.files);
    },
    [readFiles],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!dragOver) setDragOver(true);
  }, [dragOver]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current += 1;
    setDragOver(true);
  }, []);

  const dragCounter = useRef(0);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragOver(false);
    }
  }, []);

  // Keyboard shortcuts: Cmd+P → prompt picker, Cmd+Q → quest picker
  useEffect(() => {
    if (activeSessionId) return; // only before first message
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "p") {
        e.preventDefault();
        setShowAttachPicker((prev) => (prev === "prompt" ? null : "prompt"));
        setAttachSearch("");
        setActiveTagFilters([]);
      } else if (e.key === "q") {
        e.preventDefault();
        setShowAttachPicker((prev) => (prev === "quest" ? null : "quest"));
        setAttachSearch("");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeSessionId]);

  // Recent prompts (stored in localStorage)
  const recentPromptNames = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("aeqi:recent-prompts") || "[]") as string[];
    } catch { return []; }
  }, [showAttachPicker]);

  const trackRecentPrompt = useCallback((name: string) => {
    try {
      const recent = JSON.parse(localStorage.getItem("aeqi:recent-prompts") || "[]") as string[];
      const updated = [name, ...recent.filter((n) => n !== name)].slice(0, 8);
      localStorage.setItem("aeqi:recent-prompts", JSON.stringify(updated));
    } catch {}
  }, []);

  // All unique tags from available prompts
  const allTags = useMemo(() => {
    const tags = new Set<string>();
    availablePrompts.forEach((p) => p.tags.forEach((t) => tags.add(t)));
    return Array.from(tags).sort();
  }, [availablePrompts]);

  // Load sessions for this agent
  useEffect(() => {
    if (!agentId) return;
    api
      .getSessions(agentId)
      .then((d: Record<string, unknown>) => {
        const list: SessionInfo[] = (d.sessions as SessionInfo[]) || [];
        setSessions(list);
      })
      .catch(() => setSessions([]));
  }, [agentId]);

  // Start a new conversation: drop session param, show empty composer.
  const handleNewConversation = useCallback(() => {
    prevSessionRef.current = null;
    setMessages([]);
    setStreamText("");
    setLiveToolEvents([]);
    setLiveSegments([]);
    setSession(null);
    setShowSessionList(false);
  }, [setSession]);

  // Switch to an existing session — force reload
  const handleSelectSession = useCallback(
    (sid: string) => {
      prevSessionRef.current = null; // Force reload on next effect
      setMessages([]);
      setSession(sid);
      setShowSessionList(false);
    },
    [setSession],
  );

  // Process raw messages from API into our format
  const processRawMessages = useCallback((rawMessages: Array<Record<string, unknown>>): Message[] => {
    const processed: Message[] = [];
    let pendingToolSegments: MessageSegment[] = [];

    for (const m of rawMessages) {
      const eventType = m.event_type || "message";
      if (eventType === "tool_complete") {
        const meta = (m.metadata || {}) as Record<string, unknown>;
        pendingToolSegments.push({
          kind: "tool",
          event: {
            type: "complete",
            name: String(meta.tool_name || m.content || "tool"),
            success: meta.success !== false,
            input_preview: meta.input_preview as string | undefined,
            output_preview: meta.output_preview as string | undefined,
            duration_ms: meta.duration_ms as number | undefined,
            timestamp: m.created_at
              ? new Date(String(m.created_at)).getTime()
              : Date.now(),
          },
        });
      } else if (m.role === "assistant") {
        const segments: MessageSegment[] = [
          ...pendingToolSegments,
          { kind: "text", text: String(m.content || "") },
        ];
        pendingToolSegments = [];
        processed.push({
          role: String(m.role),
          content: String(m.content || ""),
          segments,
          timestamp: m.created_at
            ? new Date(String(m.created_at)).getTime()
            : undefined,
        });
      } else {
        pendingToolSegments = [];
        processed.push({
          role: String(m.role || "user"),
          content: String(m.content || ""),
          timestamp: m.created_at
            ? new Date(String(m.created_at)).getTime()
            : m.timestamp
              ? new Date(String(m.timestamp)).getTime()
              : undefined,
        });
      }
    }
    return processed;
  }, []);

  // Load messages when session changes (only if we have a session)
  const prevSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeSessionId) {
      // No session = new conversation, clear everything
      setMessages([]);
      setStreamText("");
      setLiveToolEvents([]);
    setLiveSegments([]);
      prevSessionRef.current = null;
      return;
    }

    // If we just created this session (messages already in state from streaming), don't reload
    if (activeSessionId === prevSessionRef.current) return;
    prevSessionRef.current = activeSessionId;

    // Clear and reload from API
    setStreamText("");
    setLiveToolEvents([]);
    setLiveSegments([]);

    api
      .getSessionMessages({ session_id: activeSessionId, limit: 50 })
      .then((d: Record<string, unknown>) => {
        const loaded = processRawMessages((d.messages as Array<Record<string, unknown>>) || []);
        // Only replace if we got messages — preserve local state if API returns empty
        // (race condition: messages might not be persisted yet)
        if (loaded.length > 0) {
          setMessages(loaded);
        }
      })
      .catch(() => {});
  }, [activeSessionId, processRawMessages]);

  // Auto-scroll
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, [agentId]);

  // Send message via WebSocket streaming.
  // If no active session, creates one first, then sends.
  const handleSend = useCallback(async () => {
    if (!input.trim() || streaming || !token) return;

    const messageText = input;
    const startTime = Date.now();
    const userMsg: Message = {
      role: "user",
      content: messageText,
      timestamp: startTime,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setStreaming(true);
    setStreamText("");
    setLiveToolEvents([]);
    setLiveSegments([]);
    setThinkingStart(startTime);

    // If no active session, create one with the first message.
    let sessionId = activeSessionId;
    if (!sessionId) {
      try {
        const d = await api.createSession(agentId);
        if (d.session_id) {
          sessionId = d.session_id as string;
          // Update URL to include the new session
          setSession(sessionId);
          // Add to session list
          setSessions((prev) => [
            {
              id: d.session_id as string,
              agent_id: agentId,
              agent_name: agentName,
              status: "active",
              created_at: new Date().toISOString(),
              first_message: messageText.slice(0, 60),
            },
            ...prev,
          ]);
        }
      } catch {
        // If session creation fails, still try to send
      }
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const company = localStorage.getItem("aeqi_company") || "";
    const ws = new WebSocket(
      `${protocol}//${window.location.host}/api/chat/stream?token=${token}&company=${encodeURIComponent(company)}`,
    );
    wsRef.current = ws;

    ws.onopen = () => {
      const payload: Record<string, unknown> = {
        message: messageText,
        agent_id: agentId || undefined,
        session_id: sessionId || undefined,
      };
      // Include prompts, quest, and files on first message (session creation)
      if (!activeSessionId) {
        if (sessionPrompts.length > 0) {
          payload.session_prompts = sessionPrompts;
        }
        if (sessionTask) {
          payload.quest_id = sessionTask.id;
        }
        if (attachedFiles.length > 0) {
          payload.files = attachedFiles.map((f) => ({
            name: f.name,
            content: f.content,
          }));
        }
      }
      ws.send(JSON.stringify(payload));
    };

    let fullText = "";
    let done = false;
    const toolEvents: ToolEvent[] = [];
    const segments: MessageSegment[] = [];

    const appendText = (delta: string) => {
      const last = segments[segments.length - 1];
      if (last && last.kind === "text") {
        last.text += delta;
      } else {
        segments.push({ kind: "text", text: delta });
      }
      fullText += delta;
    };

    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        switch (event.type) {
          case "TextDelta": {
            appendText(event.text || event.delta || "");
            setStreamText(fullText);
            setLiveSegments([...segments]);
            break;
          }
          case "ToolCall":
          case "ToolStart": {
            const name =
              event.name || event.tool_name || event.tool_use_id || "tool";
            const ev: ToolEvent = {
              type: "start",
              name,
              timestamp: Date.now(),
            };
            toolEvents.push(ev);
            segments.push({ kind: "tool", event: ev });
            setLiveToolEvents([...toolEvents]);
            setLiveSegments([...segments]);
            break;
          }
          case "ToolResult":
          case "ToolComplete": {
            const name =
              event.name || event.tool_name || event.tool_use_id || "tool";
            const completed: ToolEvent = {
              type: "complete",
              name,
              success: event.success !== false,
              input_preview: event.input_preview || undefined,
              output_preview: event.output_preview || event.output || "",
              duration_ms: event.duration_ms,
              timestamp: Date.now(),
            };
            const startIdx = toolEvents.findIndex(
              (e) => e.type === "start" && e.name === name,
            );
            if (startIdx >= 0) toolEvents[startIdx] = completed;
            else toolEvents.push(completed);
            const segIdx = segments.findIndex(
              (s) =>
                s.kind === "tool" &&
                s.event.type === "start" &&
                s.event.name === name,
            );
            if (segIdx >= 0)
              segments[segIdx] = { kind: "tool", event: completed };
            else segments.push({ kind: "tool", event: completed });
            setLiveToolEvents([...toolEvents]);
            setLiveSegments([...segments]);
            break;
          }
          case "TurnStart": {
            const turnNum = event.turn || 0;
            toolEvents.push({
              type: "turn",
              name: `Turn ${turnNum}`,
              timestamp: Date.now(),
            });
            segments.push({ kind: "status", text: `Turn ${turnNum}` });
            setLiveToolEvents([...toolEvents]);
            setLiveSegments([...segments]);
            break;
          }
          case "Status": {
            const statusMsg = event.message || "";
            toolEvents.push({
              type: "status",
              name: statusMsg,
              timestamp: Date.now(),
            });
            segments.push({ kind: "status", text: statusMsg });
            setLiveToolEvents([...toolEvents]);
            setLiveSegments([...segments]);
            break;
          }
          case "Compacted": {
            toolEvents.push({
              type: "status",
              name: `Context compacted (${event.original_messages}\u2192${event.remaining_messages} msgs)`,
              timestamp: Date.now(),
            });
            setLiveToolEvents([...toolEvents]);
            break;
          }
          case "MemoryActivity": {
            const desc = `${event.action}: ${event.key}`;
            toolEvents.push({
              type: "status",
              name: desc,
              timestamp: Date.now(),
            });
            setLiveToolEvents([...toolEvents]);
            break;
          }
          case "DelegateStart": {
            const workerName = event.worker_name || "subagent";
            const subject = event.quest_subject || "delegated quest";
            toolEvents.push({
              type: "start",
              name: `delegate: ${workerName}`,
              timestamp: Date.now(),
            });
            segments.push({
              kind: "status",
              text: `Delegating to ${workerName}: ${subject}`,
            });
            setLiveToolEvents([...toolEvents]);
            break;
          }
          case "DelegateComplete": {
            const doneWorker = event.worker_name || "subagent";
            const delegateStartIdx = toolEvents.findIndex(
              (e) => e.type === "start" && e.name === `delegate: ${doneWorker}`,
            );
            if (delegateStartIdx >= 0) {
              toolEvents[delegateStartIdx] = {
                type: "complete",
                name: `delegate: ${doneWorker}`,
                success: true,
                output_preview: event.outcome,
                timestamp: Date.now(),
              };
            }
            const outcomePreview = (event.outcome || "").slice(0, 200);
            segments.push({
              kind: "status",
              text: `${doneWorker} completed: ${outcomePreview}`,
            });
            setLiveToolEvents([...toolEvents]);
            break;
          }
          case "Complete":
          case "done": {
            if (!event.done && event.type === "Complete") break;
            done = true;
            const endTime = Date.now();
            const duration = formatDuration(startTime, endTime);
            const hasContent = fullText || toolEvents.length > 0;
            if (hasContent) {
              const promptTok = event.prompt_tokens || 0;
              const completionTok = event.completion_tokens || 0;
              setMessages((prev) => [
                ...prev,
                {
                  role: "assistant",
                  content: fullText || "(no text output)",
                  segments: segments.length > 0 ? [...segments] : undefined,
                  timestamp: endTime,
                  duration,
                  toolEvents:
                    toolEvents.length > 0 ? [...toolEvents] : undefined,
                  costUsd: event.cost_usd || undefined,
                  tokenUsage:
                    promptTok || completionTok
                      ? { prompt: promptTok, completion: completionTok }
                      : undefined,
                },
              ]);
            }
            setStreamText("");
            setStreaming(false);
            setLiveToolEvents([]);
    setLiveSegments([]);
            setThinkingStart(null);
            ws.close();
            break;
          }
          case "Error":
            done = true;
            setMessages((prev) => [
              ...prev,
              {
                role: "error",
                content: event.message || "Unknown error",
                timestamp: Date.now(),
                duration: formatDuration(startTime, Date.now()),
              },
            ]);
            setStreaming(false);
            setThinkingStart(null);
            ws.close();
            break;
        }
      } catch {
        /* ignore malformed */
      }
    };

    ws.onerror = () => {
      setStreaming(false);
      setThinkingStart(null);
    };
    ws.onclose = () => {
      if (!done && fullText) {
        const endTime = Date.now();
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: fullText,
            timestamp: endTime,
            duration: formatDuration(startTime, endTime),
            toolEvents: toolEvents.length > 0 ? [...toolEvents] : undefined,
          },
        ]);
        setStreamText("");
      }
      setStreaming(false);
      setThinkingStart(null);
    };
  }, [input, streaming, token, agentId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  if (!agentId) return null;

  return (
    <div
      className={`asv ${dragOver ? "asv--dragover" : ""}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
    >
      {/* Session header */}
      <div className="asv-header">
        <div className="asv-header-info">
          <RoundAvatar name={agentName} size={24} />
          <div className="asv-header-text">
            <span className="asv-header-name">{displayName}</span>
            {activeSessionId && (
              <span className="asv-header-session-name">
                {sessions.find((s) => s.id === activeSessionId)?.first_message?.slice(0, 40) || `Session ${activeSessionId.slice(0, 8)}`}
              </span>
            )}
          </div>
          <span className={`asv-header-dot ${wsConnected ? "live" : ""}`} />
        </div>
        <div className="asv-header-actions">
          {agentInfo?.model && (
            <span className="asv-header-model">{agentInfo.model}</span>
          )}
          <button
            className={`asv-session-toggle ${showSessionList ? "asv-session-toggle--open" : ""}`}
            onClick={() => setShowSessionList(!showSessionList)}
            title="Sessions"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 3.5h10M2 7h10M2 10.5h10" />
            </svg>
            {sessions.length > 0 && (
              <span className="asv-session-count">{sessions.length}</span>
            )}
          </button>
          <button
            className="asv-new-session"
            onClick={handleNewConversation}
            title="New conversation"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M7 3v8M3 7h8" />
            </svg>
          </button>
        </div>
      </div>

      {/* Session list dropdown */}
      {showSessionList && (
        <div className="asv-session-list">
          {sessions.length === 0 ? (
            <div className="asv-session-empty">
              No sessions yet. Start a conversation below.
            </div>
          ) : (
            sessions.map((s) => {
              const isActive = s.id === activeSessionId;
              const isLive = s.status === "active";
              const preview = s.first_message || `Session ${s.id.slice(0, 8)}`;
              const date = new Date(s.created_at);
              const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
              const dateStr = date.toLocaleDateString([], { month: "short", day: "numeric" });
              return (
                <div
                  key={s.id}
                  className={`asv-session-item${isActive ? " active" : ""}`}
                  onClick={() => { handleSelectSession(s.id); setShowSessionList(false); }}
                >
                  <div className="asv-session-item-top">
                    <span className={`asv-session-dot ${isLive ? "live" : ""}`} />
                    <span className="asv-session-item-preview">{preview}</span>
                  </div>
                  <div className="asv-session-item-bottom">
                    <span className="asv-session-item-date">{dateStr} {timeStr}</span>
                    {s.message_count != null && (
                      <span className="asv-session-item-count">{s.message_count} msgs</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Message transcript */}
      <div className="asv-messages">
        {messages.length === 0 && !streaming && (
          <div className="asv-empty">
            <div className="asv-empty-icon">
              <RoundAvatar name={agentName} size={48} />
            </div>
            <div className="asv-empty-title">Message {displayName}</div>
            <div className="asv-empty-hint">
              {activeSessionId
                ? "Continue this conversation."
                : "Your message starts a new session."}
            </div>
          </div>
        )}

        {messages.map((msg, i) => {
          if (msg.role === "quest_event") {
            return (
              <div key={i} className="asv-quest-event">
                <span className="asv-quest-event-icon">
                  {(msg.eventType || "").includes("create")
                    ? "+"
                    : (msg.eventType || "").includes("complete") ||
                        (msg.eventType || "").includes("close")
                      ? "\u2713"
                      : (msg.eventType || "").includes("block")
                        ? "!"
                        : "\u2192"}
                </span>
                <span className="asv-quest-event-text">{msg.content}</span>
                {msg.timestamp && (
                  <span className="asv-quest-event-time">
                    {formatTime(msg.timestamp)}
                  </span>
                )}
              </div>
            );
          }
          if (msg.role === "error") {
            return (
              <div key={i} className="asv-msg asv-msg-error">
                <div className="asv-msg-header">
                  <span className="asv-msg-role">error</span>
                  {msg.duration && (
                    <span className="asv-msg-duration">{msg.duration}</span>
                  )}
                </div>
                <div className="asv-msg-content">{msg.content}</div>
              </div>
            );
          }
          const userName = localStorage.getItem("aeqi_user_name") || "operator";
          return (
            <div key={i} className={`asv-msg asv-msg-${msg.role}`}>
              <div className="asv-msg-avatar">
                <RoundAvatar
                  name={msg.role === "assistant" ? agentName : userName}
                  size={24}
                />
              </div>
              <div className="asv-msg-body">
                <div className="asv-msg-header">
                  <span className="asv-msg-role">
                    {msg.role === "assistant" ? displayName : "you"}
                  </span>
                  {msg.timestamp && (
                    <span className="asv-msg-time">
                      {formatTime(msg.timestamp)}
                    </span>
                  )}
                  {msg.duration && (
                    <span className="asv-msg-duration">{msg.duration}</span>
                  )}
                  {msg.costUsd != null && msg.costUsd > 0 && (
                    <span className="asv-msg-cost">
                      ${msg.costUsd.toFixed(4)}
                    </span>
                  )}
                  {msg.tokenUsage &&
                    (msg.tokenUsage.prompt > 0 ||
                      msg.tokenUsage.completion > 0) && (
                      <span className="asv-msg-tokens">
                        {msg.tokenUsage.prompt}\u2192{msg.tokenUsage.completion}{" "}
                        tok
                      </span>
                    )}
                </div>

                {msg.segments && msg.segments.length > 0 ? (
                  <>
                    <SegmentRenderer segments={msg.segments} />
                    {msg.role === "assistant" && (
                      <CopyButton text={msg.content} />
                    )}
                  </>
                ) : (
                  <>
                    <div className="asv-msg-content">
                      {msg.role === "assistant" ? (
                        <Markdown>{msg.content}</Markdown>
                      ) : (
                        <span>{msg.content}</span>
                      )}
                    </div>
                    {msg.role === "assistant" && (
                      <CopyButton text={msg.content} />
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}

        {/* Live streaming — segments in order */}
        {streaming && (
          <div className="asv-msg asv-msg-assistant asv-msg-streaming">
            <div className="asv-msg-avatar">
              <RoundAvatar name={agentName} size={24} />
            </div>
            <div className="asv-msg-body">
              <div className="asv-msg-header">
                <span className="asv-msg-role">{displayName}</span>
                {thinkingStart && <ThinkingTimer start={thinkingStart} />}
              </div>
              {(() => {
                // Group live segments: text directly, turns as separators, tools in panels
                type LiveGroup =
                  | { kind: "text"; text: string }
                  | { kind: "turn"; text: string }
                  | { kind: "tools"; items: MessageSegment[] };
                const groups: LiveGroup[] = [];
                for (const seg of liveSegments) {
                  if (seg.kind === "text") {
                    groups.push({ kind: "text", text: seg.text });
                  } else if (seg.kind === "status" && seg.text.startsWith("Turn ")) {
                    groups.push({ kind: "turn", text: seg.text });
                  } else {
                    const last = groups[groups.length - 1];
                    if (last && last.kind === "tools") {
                      last.items.push(seg);
                    } else {
                      groups.push({ kind: "tools", items: [seg] });
                    }
                  }
                }
                return groups.map((group, gi) =>
                  group.kind === "text" ? (
                    <div key={gi} className="asv-msg-content">
                      <Markdown>{group.text}</Markdown>
                    </div>
                  ) : group.kind === "turn" ? (
                    <div key={gi} className="asv-turn-sep">
                      <span className="asv-turn-label">{group.text}</span>
                    </div>
                  ) : (
                    <div key={gi} className="asv-tools-group asv-tools-group--live">
                      {group.items.map((seg, si) =>
                        seg.kind === "tool" ? (
                          <div key={si} className={`asv-tool-inline ${seg.event.type} ${toolCategoryClass(seg.event.name)}`}>
                            <span className={`asv-tool-icon ${toolCategoryClass(seg.event.name)}`}>
                              {toolCategoryIcon(seg.event.name)}
                            </span>
                            <span className="asv-tool-name">{toolLabel(seg.event.name)}</span>
                            {seg.event.duration_ms != null && (
                              <span className="asv-tool-ms">{formatMs(seg.event.duration_ms)}</span>
                            )}
                          </div>
                        ) : seg.kind === "status" ? (
                          <div key={si} className="asv-status-item">{seg.text}</div>
                        ) : null,
                      )}
                    </div>
                  ),
                );
              })()}
              {!liveSegments.length && <ThinkingStatus />}
              {liveToolEvents.some((e) => e.type === "start") && (
                <ThinkingStatus
                  toolName={toolLabel(liveToolEvents.filter((e) => e.type === "start").pop()?.name || "")}
                />
              )}
            </div>
          </div>
        )}

        <div ref={messagesEnd} />
      </div>

      {/* Session attachments — prompts, quest, files (only visible before first message) */}
      {!activeSessionId && (
        <div
          className="asv-attach-bar"
        >
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              if (e.target.files) readFiles(e.target.files);
              e.target.value = "";
            }}
          />
          {/* Attached chips */}
          {(sessionPrompts.length > 0 || sessionTask || attachedFiles.length > 0) && (
            <div className="asv-attach-chips">
              {sessionPrompts.map((p, i) => (
                <div
                  key={`p-${i}`}
                  className="asv-attach-chip asv-attach-chip--prompt"
                >
                  <span className="asv-attach-chip-icon">⚡</span>
                  <span className="asv-attach-chip-text">{p}</span>
                  <span
                    className="asv-attach-chip-x"
                    onClick={() =>
                      setSessionPrompts((prev) =>
                        prev.filter((_, j) => j !== i),
                      )
                    }
                  >
                    ×
                  </span>
                </div>
              ))}
              {sessionTask && (
                <div className="asv-attach-chip asv-attach-chip--quest">
                  <span className="asv-attach-chip-icon">◆</span>
                  <span className="asv-attach-chip-text">
                    {sessionTask.name}
                  </span>
                  <span
                    className="asv-attach-chip-x"
                    onClick={() => setSessionTask(null)}
                  >
                    ×
                  </span>
                </div>
              )}
              {attachedFiles.map((f, i) => (
                <div key={`f-${i}`} className="asv-attach-chip asv-attach-chip--file">
                  <span className="asv-attach-chip-icon">📎</span>
                  <span className="asv-attach-chip-text">{f.name}</span>
                  <span className="asv-attach-chip-meta">{(f.size / 1024).toFixed(0)}K</span>
                  <span
                    className="asv-attach-chip-x"
                    onClick={() => setAttachedFiles((prev) => prev.filter((_, j) => j !== i))}
                  >
                    ×
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Picker dropdown */}
          {showAttachPicker && (
            <div className="asv-attach-picker">
              <div className="asv-attach-picker-header">
                <input
                  className="asv-attach-picker-search"
                  placeholder={
                    showAttachPicker === "prompt"
                      ? "Search prompts..."
                      : "Search quests..."
                  }
                  value={attachSearch}
                  onChange={(e) => setAttachSearch(e.target.value)}
                  autoFocus
                />
                <button
                  className="asv-attach-picker-close"
                  onClick={() => {
                    setShowAttachPicker(null);
                    setAttachSearch("");
                  }}
                >
                  ×
                </button>
              </div>
              {/* Tag filters */}
              {showAttachPicker === "prompt" && allTags.length > 0 && (
                <div className="asv-attach-picker-tags">
                  {allTags.map((tag) => (
                    <button
                      key={tag}
                      className={`asv-tag-btn ${activeTagFilters.includes(tag) ? "asv-tag-btn--active" : ""}`}
                      onClick={() =>
                        setActiveTagFilters((prev) =>
                          prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
                        )
                      }
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              )}
              <div className="asv-attach-picker-list">
                {showAttachPicker === "prompt" && (
                  <>
                    {/* Recent section */}
                    {!attachSearch && activeTagFilters.length === 0 && recentPromptNames.length > 0 && (
                      <>
                        <div className="asv-attach-picker-section">Recent</div>
                        {recentPromptNames
                          .filter((name) => !sessionPrompts.includes(name))
                          .filter((name) => availablePrompts.some((p) => p.name === name))
                          .slice(0, 4)
                          .map((name) => {
                            const p = availablePrompts.find((pr) => pr.name === name)!;
                            return (
                              <div
                                key={`recent-${p.name}`}
                                className="asv-attach-picker-item"
                                onClick={() => {
                                  setSessionPrompts((prev) => [...prev, p.name]);
                                  trackRecentPrompt(p.name);
                                  setAttachSearch("");
                                  setShowAttachPicker(null);
                                }}
                                onMouseEnter={() => setHoveredPrompt(p.description)}
                                onMouseLeave={() => setHoveredPrompt(null)}
                              >
                                <span className="asv-attach-picker-item-name">{p.name}</span>
                                <span className="asv-attach-picker-item-tags">{p.tags.join(", ")}</span>
                              </div>
                            );
                          })}
                        <div className="asv-attach-picker-section">All</div>
                      </>
                    )}
                    {availablePrompts
                      .filter((p) => {
                        const q = attachSearch.toLowerCase();
                        const textMatch =
                          !q ||
                          p.name.toLowerCase().includes(q) ||
                          p.description.toLowerCase().includes(q) ||
                          p.tags.some((t) => t.includes(q));
                        const tagMatch =
                          activeTagFilters.length === 0 ||
                          activeTagFilters.every((tf) => p.tags.includes(tf));
                        return textMatch && tagMatch;
                      })
                      .filter((p) => !sessionPrompts.includes(p.name))
                      .map((p) => (
                        <div
                          key={p.name}
                          className="asv-attach-picker-item"
                          onClick={() => {
                            setSessionPrompts((prev) => [...prev, p.name]);
                            trackRecentPrompt(p.name);
                            setAttachSearch("");
                            setShowAttachPicker(null);
                            setActiveTagFilters([]);
                          }}
                          onMouseEnter={() => setHoveredPrompt(p.description)}
                          onMouseLeave={() => setHoveredPrompt(null)}
                        >
                          <span className="asv-attach-picker-item-name">
                            {p.name}
                          </span>
                          <span className="asv-attach-picker-item-desc">
                            {p.description}
                          </span>
                          {p.tags.length > 0 && (
                            <span className="asv-attach-picker-item-tags">
                              {p.tags.join(", ")}
                            </span>
                          )}
                        </div>
                      ))}
                    {availablePrompts.length === 0 && (
                      <div className="asv-attach-picker-empty">
                        No prompts found
                      </div>
                    )}
                  </>
                )}
                {showAttachPicker === "quest" && (
                  <>
                    {availableTasks
                      .filter(
                        (t) =>
                          !attachSearch ||
                          t.name
                            .toLowerCase()
                            .includes(attachSearch.toLowerCase()),
                      )
                      .map((t) => (
                        <div
                          key={t.id}
                          className="asv-attach-picker-item"
                          onClick={() => {
                            setSessionTask({ id: t.id, name: t.name });
                            setAttachSearch("");
                            setShowAttachPicker(null);
                          }}
                        >
                          <span className="asv-attach-picker-item-name">
                            {t.name}
                          </span>
                          <span className="asv-attach-picker-item-desc">
                            {t.id}
                          </span>
                        </div>
                      ))}
                    {availableTasks.length === 0 && (
                      <div className="asv-attach-picker-empty">
                        No open quests
                      </div>
                    )}
                  </>
                )}
              </div>
              <a
                className="asv-attach-picker-create"
                href={showAttachPicker === "prompt" ? "/prompts" : "/quests"}
                target="_blank"
                rel="noreferrer"
              >
                + create new {showAttachPicker === "quest" ? "quest" : showAttachPicker}
              </a>
              {/* Hover preview */}
              {hoveredPrompt && (
                <div className="asv-attach-picker-preview">
                  {hoveredPrompt}
                </div>
              )}
            </div>
          )}

          {/* Toggle buttons */}
          {!showAttachPicker && (
            <div className="asv-attach-toggles">
              <button
                className="asv-attach-toggle"
                onClick={() => { setShowAttachPicker("prompt"); setActiveTagFilters([]); }}
              >
                + prompt <span className="asv-attach-shortcut">⌘P</span>
              </button>
              <button
                className="asv-attach-toggle"
                onClick={() => setShowAttachPicker("quest")}
              >
                + quest <span className="asv-attach-shortcut">⌘Q</span>
              </button>
              <button
                className="asv-attach-toggle"
                onClick={() => fileInputRef.current?.click()}
              >
                + file
              </button>
            </div>
          )}
        </div>
      )}

      {/* Input box */}
      <div className="asv-composer">
        <div
          className={`asv-composer-inner ${streaming ? "asv-composer-busy" : ""}`}
        >
          <textarea
            ref={inputRef}
            className="asv-textarea"
            placeholder={
              streaming ? "Responding..." : `Message ${displayName}...`
            }
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onDrop={(e) => {
              if (e.dataTransfer.files.length > 0) {
                e.preventDefault();
                e.stopPropagation();
                dragCounter.current = 0;
                setDragOver(false);
                readFiles(e.dataTransfer.files);
              }
            }}
            disabled={streaming}
            rows={1}
          />
          <button
            className={`asv-send ${input.trim() && !streaming ? "ready" : ""} ${streaming ? "busy" : ""}`}
            onClick={handleSend}
            disabled={!input.trim() || streaming}
          >
            {streaming ? (
              <svg
                className="asv-send-spinner"
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle
                  cx="8"
                  cy="8"
                  r="6"
                  strokeDasharray="28"
                  strokeDashoffset="8"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  d="M2 8h12M10 4l4 4-4 4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
