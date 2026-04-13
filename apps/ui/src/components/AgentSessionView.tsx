import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import { useNavigate } from "react-router-dom";
import Markdown from "react-markdown";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import RoundAvatar from "./RoundAvatar";

// ── Types ──

interface ToolEvent {
  type: "start" | "complete" | "step" | "status";
  name: string;
  id?: string;
  success?: boolean;
  input_preview?: string;
  output_preview?: string;
  duration_ms?: number;
  timestamp: number;
}

type MessageSegment =
  | { kind: "text"; text: string }
  | { kind: "tool"; event: ToolEvent }
  | { kind: "step"; step: number }
  | { kind: "status"; text: string };

interface Message {
  role: string;
  content: string;
  segments?: MessageSegment[];
  timestamp?: number;
  duration?: string;
  costUsd?: number;
  stepCount?: number;
  tokenUsage?: { prompt: number; completion: number };
  eventType?: string;
  taskId?: string;
  queued?: boolean;
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
  // Consolidated tools
  agents: "Agents",
  quests: "Quests",
  events: "Events",
  ideas: "Ideas",
  code: "Code",
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

function shouldRenderStatus(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  if (/^step \d+$/.test(normalized)) return false;
  if (normalized === "recalling ideas...") return false;
  return true;
}

function numberFromMeta(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function formatStepCount(count: number): string {
  return `${count} step${count === 1 ? "" : "s"}`;
}

function countStepSegments(segments?: MessageSegment[]): number {
  return segments?.filter((seg) => seg.kind === "step").length || 0;
}

function applyAssistantMeta(message: Message, meta: Record<string, unknown>) {
  const durationMs = numberFromMeta(meta.duration_ms);
  const costUsd = numberFromMeta(meta.cost_usd);
  const stepCount = numberFromMeta(meta.iterations ?? meta.steps ?? meta.step_count);
  const promptTokens = numberFromMeta(meta.prompt_tokens ?? meta.total_prompt_tokens);
  const completionTokens = numberFromMeta(meta.completion_tokens ?? meta.total_completion_tokens);

  if (durationMs != null && durationMs > 0) {
    message.duration = formatDuration(0, durationMs);
  }
  if (costUsd != null && costUsd > 0) {
    message.costUsd = costUsd;
  }
  if (stepCount != null && stepCount > 0) {
    message.stepCount = Math.round(stepCount);
  }
  if ((promptTokens != null && promptTokens > 0) || (completionTokens != null && completionTokens > 0)) {
    message.tokenUsage = {
      prompt: Math.round(promptTokens || 0),
      completion: Math.round(completionTokens || 0),
    };
  }
}

function currentRunningToolName(segments: MessageSegment[]): string | undefined {
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (seg.kind === "tool" && seg.event.type === "start") {
      return toolLabel(seg.event.name);
    }
  }
  return undefined;
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
function ToolBlock({ items, live = false }: { items: MessageSegment[]; live?: boolean }) {
  const [expanded, setExpanded] = useState(live);
  const tools = items.filter((s): s is { kind: "tool"; event: ToolEvent } => s.kind === "tool");
  const count = tools.length;
  const cats = [...new Set(tools.map((t) => {
    const n = t.event.name;
    if (n.startsWith("agents_")) return "agents";
    if (n.startsWith("quests_")) return "quests";
    if (n.startsWith("events_")) return "events";
    if (n.startsWith("ideas_")) return "ideas";
    if (n.startsWith("prompts_")) return "prompts";
    if (n.startsWith("web_")) return "web";
    return "system";
  }))];
  const hasFail = tools.some((t) => t.event.success === false);
  const showDetail = live || expanded;

  return (
    <div className={`asv-tools-group${live ? " asv-tools-group--live" : ""}${hasFail ? " asv-tools-group--fail" : ""}`}>
      {!live && (
        <button className="asv-tools-toggle" onClick={() => setExpanded(!expanded)}>
          <span className="asv-tools-chevron">{expanded ? "▾" : "▸"}</span>
          <span className="asv-tools-count">{count} tool{count !== 1 ? "s" : ""}</span>
          {!expanded && cats.length > 0 && (
            <span className="asv-tools-cats">{cats.join(", ")}</span>
          )}
        </button>
      )}
      {showDetail && (
        <div className="asv-tools-detail">
          {items.map((seg, si) =>
            seg.kind === "tool" ? (
              <div key={si} className={`asv-tool-row${seg.event.success === false ? " fail" : ""}`}>
                <span className={`asv-tool-dot ${seg.event.type}`} />
                <span className="asv-tool-name">{toolLabel(seg.event.name)}</span>
                {seg.event.duration_ms != null && (
                  <span className="asv-tool-dur">{formatMs(seg.event.duration_ms)}</span>
                )}
                {!live && seg.event.output_preview && (
                  <ExpandableOutput text={seg.event.output_preview} />
                )}
              </div>
            ) : seg.kind === "status" ? (
              <div key={si} className="asv-tool-status-msg">{seg.text}</div>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}

/** Renders segments, grouping consecutive tool items into blocks. */
function SegmentRenderer({ segments, live = false }: { segments: MessageSegment[]; live?: boolean }) {
  type SegGroup =
    | { kind: "text"; text: string }
    | { kind: "step"; step: number }
    | { kind: "status"; text: string }
    | { kind: "tools"; items: MessageSegment[] };
  const groups: SegGroup[] = [];
  for (const seg of segments) {
    if (seg.kind === "text") {
      groups.push({ kind: "text", text: seg.text });
    } else if (seg.kind === "step") {
      groups.push({ kind: "step", step: seg.step });
    } else if (seg.kind === "status") {
      const stepMatch = seg.text.trim().match(/^step\s+(\d+)$/i);
      if (stepMatch) {
        groups.push({ kind: "step", step: Number(stepMatch[1]) });
      } else if (shouldRenderStatus(seg.text)) {
        groups.push({ kind: "status", text: seg.text });
      }
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
            <Markdown components={markdownComponents}>{group.text}</Markdown>
          </div>
        ) : group.kind === "step" ? (
          <div key={gi} className="asv-step-sep">
            <span>{`Step ${group.step}`}</span>
          </div>
        ) : group.kind === "status" ? (
          <div key={gi} className="asv-status-line">{group.text}</div>
        ) : (
          <ToolBlock key={gi} items={group.items} live={live} />
        ),
      )}
    </>
  );
}

/** Code block with language label + copy button */
function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const lang = className?.replace("language-", "") || "";
  const code = String(children).replace(/\n$/, "");
  return (
    <div className="asv-codeblock">
      <div className="asv-codeblock-header">
        <span className="asv-codeblock-lang">{lang}</span>
        <button
          className="asv-codeblock-copy"
          onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre><code className={className}>{children}</code></pre>
    </div>
  );
}

/** Custom markdown components — code blocks get headers */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const markdownComponents: any = {
  code({ className, children, ...props }: { className?: string; children?: React.ReactNode }) {
    const isBlock = className?.startsWith("language-");
    if (isBlock) {
      return <CodeBlock className={className}>{children}</CodeBlock>;
    }
    return <code className={className} {...props}>{children}</code>;
  },
  pre({ children }: { children?: React.ReactNode }) {
    return <>{children}</>;
  },
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      className="asv-copy"
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
  return (
    <div className="asv-thinking">
      <span className="asv-thinking-dot" />
      <span className="asv-thinking-text">{toolName ? `${toolName}...` : "thinking..."}</span>
    </div>
  );
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

// ── Memoized message item — prevents re-rendering historical messages during streaming ──

const MessageItem = memo(function MessageItem({
  msg,
  agentName,
  userName,
  userAvatarUrl,
}: {
  msg: Message;
  agentName: string;
  userName: string;
  userAvatarUrl: string | null;
}) {
  if (msg.role === "quest_event") {
    return (
      <div className="asv-quest-event">
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
      <div className="asv-msg asv-msg-error">
        <div className="asv-msg-header">
          {msg.duration && (
            <span className="asv-msg-duration">{msg.duration}</span>
          )}
        </div>
        <div className="asv-msg-content">{msg.content}</div>
      </div>
    );
  }
  const stepCount = msg.stepCount || countStepSegments(msg.segments);
  const metaParts = [
    msg.timestamp && formatTime(msg.timestamp),
    msg.duration,
    msg.role === "assistant" && stepCount > 0 && formatStepCount(stepCount),
    msg.costUsd != null && msg.costUsd > 0 && `$${msg.costUsd.toFixed(4)}`,
    msg.tokenUsage && (msg.tokenUsage.prompt > 0 || msg.tokenUsage.completion > 0) &&
      `${msg.tokenUsage.prompt}\u2192${msg.tokenUsage.completion} tok`,
    msg.queued && "queued",
  ].filter(Boolean) as string[];
  return (
    <div className={`asv-msg asv-msg-${msg.role}${msg.queued ? " asv-msg-queued" : ""}`}>
      {msg.role === "assistant" && (
        <div className="asv-msg-avatar">
          <RoundAvatar name={agentName} size={24} />
        </div>
      )}
      <div className="asv-msg-body">
        {msg.segments && msg.segments.length > 0 ? (
          <SegmentRenderer segments={msg.segments} />
        ) : (
          <div className="asv-msg-content">
            {msg.role === "assistant" ? (
              <Markdown components={markdownComponents}>{msg.content}</Markdown>
            ) : (
              <span>{msg.content}</span>
            )}
          </div>
        )}
        {msg.role === "assistant" && msg.content.trim().length > 0 && (
          <CopyButton text={msg.content} />
        )}
        {metaParts.length > 0 && (
          <div className="asv-msg-footer">
            {metaParts.map((part, idx) => (
              <span key={idx}>{part}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

// ── Main Component ──

interface SessionInfo {
  id: string;
  agent_id?: string;
  agent_name?: string;
  name?: string;
  status: string;
  created_at: string;
  last_active?: string;
  message_count?: number;
  first_message?: string;
}

/** Derive a short display label for a session */
function sessionLabel(s: SessionInfo): string {
  // Use explicit name if set
  if (s.name && s.name !== s.id && !s.name.startsWith("session-")) return s.name;
  // Derive from first message — take first ~5 words, clean up
  if (s.first_message) {
    const words = s.first_message.replace(/[\n\r]+/g, " ").trim().split(/\s+/).slice(0, 6);
    const label = words.join(" ");
    return label.length > 32 ? label.slice(0, 30) + "..." : label;
  }
  return s.id.slice(0, 8);
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
  const authMode = useAuthStore((s) => s.authMode);
  const user = useAuthStore((s) => s.user);
  const wsConnected = useDaemonStore((s) => s.wsConnected);
  const agents = useDaemonStore((s) => s.agents);

  // Resolve agent info from the store
  const agentInfo = agents.find(
    (a) => a.id === agentId || a.name === agentId,
  );
  const agentName = agentInfo?.name || agentId;
  const displayName = agentInfo?.display_name || agentName;
  const userName = user?.name || (authMode === "none" ? "Local" : "Account");
  const userAvatarUrl = user?.avatar_url || null;

  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [showSessionList, setShowSessionList] = useState(false);

  // The active session comes from the URL
  const activeSessionId = urlSessionId;
  const sessionIdRef = useRef<string | null>(activeSessionId);
  useEffect(() => {
    sessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  // Navigate helpers
  const setSession = useCallback(
    (sid: string | null) => {
      if (sid) {
        navigate(
          `/agents?agent=${encodeURIComponent(agentId)}&session=${encodeURIComponent(sid)}`,
          { replace: true },
        );
      } else {
        navigate(`/agents?agent=${encodeURIComponent(agentId)}`, { replace: true });
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
  const [liveSegments, setLiveSegments] = useState<MessageSegment[]>([]);
  const [thinkingStart, setThinkingStart] = useState<number | null>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const messageQueueRef = useRef<string[]>([]);

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

  // Keyboard shortcuts: Cmd+P → idea picker, Cmd+Q → quest picker, Cmd+N → new session
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "n") {
        e.preventDefault();
        handleNewConversation();
      } else if (e.key === "p") {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    sessionIdRef.current = null;
    setMessages([]);
    setLiveSegments([]);
    setSession(null);
    setShowSessionList(false);
  }, [setSession]);

  // Switch to an existing session — force reload
  const handleSelectSession = useCallback(
    (sid: string) => {
      prevSessionRef.current = null; // Force reload on next effect
      sessionIdRef.current = sid;
      setMessages([]);
      setSession(sid);
      setShowSessionList(false);
    },
    [setSession],
  );

  // Process raw messages from API into our format
  const processRawMessages = useCallback((rawMessages: Array<Record<string, unknown>>): Message[] => {
    const processed: Message[] = [];
    let pendingTools: MessageSegment[] = [];
    let currentAgent: Message | null = null; // Accumulator for multi-step agent response
    let stepCount = 0;
    let sawStoredStepMarkers = false;

    const flushAgent = () => {
      if (currentAgent) {
        if (!currentAgent.stepCount) {
          currentAgent.stepCount = countStepSegments(currentAgent.segments);
        }
        processed.push(currentAgent);
        currentAgent = null;
      }
    };

    const ensureCurrentAgent = (timestamp: number) => {
      if (!currentAgent) {
        currentAgent = {
          role: "assistant",
          content: "",
          segments: [],
          timestamp,
        };
      }
      return currentAgent;
    };

    const startStep = (_step: number | undefined, timestamp: number) => {
      const message = ensureCurrentAgent(timestamp);
      // Always count from 1 per response — ignore server's session-level number
      stepCount += 1;
      message.stepCount = Math.max(message.stepCount || 0, stepCount);
      message.segments!.push({ kind: "step", step: stepCount });
      return message;
    };

    const applyMetaToCurrentAssistant = (meta: Record<string, unknown>) => {
      if (currentAgent) {
        applyAssistantMeta(currentAgent, meta);
        return;
      }
      for (let i = processed.length - 1; i >= 0; i--) {
        if (processed[i].role === "assistant") {
          applyAssistantMeta(processed[i], meta);
          return;
        }
      }
    };

    for (const m of rawMessages) {
      const eventType = m.event_type || "message";
      const ts = m.created_at ? new Date(String(m.created_at)).getTime() : Date.now();

      if (eventType === "tool_complete") {
        const meta = (m.metadata || {}) as Record<string, unknown>;
        pendingTools.push({
          kind: "tool",
          event: {
            type: "complete",
            name: String(meta.tool_name || m.content || "tool"),
            id: meta.tool_use_id ? String(meta.tool_use_id) : undefined,
            success: meta.success !== false,
            input_preview: meta.input_preview as string | undefined,
            output_preview: meta.output_preview as string | undefined,
            duration_ms: meta.duration_ms as number | undefined,
            timestamp: ts,
          },
        });
      } else if (eventType === "step_start") {
        const meta = (m.metadata || {}) as Record<string, unknown>;
        sawStoredStepMarkers = true;
        if (pendingTools.length > 0 && currentAgent) {
          currentAgent.segments!.push(...pendingTools);
          pendingTools = [];
        }
        startStep(numberFromMeta(meta.step), ts);
      } else if (eventType === "assistant_complete") {
        if (!currentAgent && pendingTools.length > 0) {
          currentAgent = {
            role: "assistant",
            content: "",
            segments: [],
            timestamp: ts,
          };
          if (!sawStoredStepMarkers) {
            startStep(undefined, ts);
          }
          currentAgent.segments!.push(...pendingTools);
          pendingTools = [];
        }
        applyMetaToCurrentAssistant((m.metadata || {}) as Record<string, unknown>);
      } else if (m.role === "assistant") {
        // Older histories do not have stored step markers, so infer one marker per persisted assistant step.
        const agent = !sawStoredStepMarkers
          ? startStep(undefined, ts)
          : ensureCurrentAgent(ts);
        if (agent.timestamp == null) {
          agent.timestamp = ts;
        } else {
          agent.timestamp = Math.min(agent.timestamp, ts);
        }
        // Flush pending tools before this step's text
        if (pendingTools.length > 0) {
          agent.segments!.push(...pendingTools);
          pendingTools = [];
        }
        // Add this step's text
        const text = String(m.content || "");
        if (text) {
          agent.segments!.push({ kind: "text", text });
          agent.content += (agent.content ? "\n\n" : "") + text;
        }
        applyAssistantMeta(agent, (m.metadata || {}) as Record<string, unknown>);
      } else if (m.role === "user" || m.role === "User") {
        // Flush any pending state
        if (pendingTools.length > 0 && currentAgent) {
          currentAgent.segments!.push(...pendingTools);
          pendingTools = [];
        }
        flushAgent();
        stepCount = 0;
        sawStoredStepMarkers = false;
        processed.push({
          role: "user",
          content: String(m.content || ""),
          timestamp: ts,
        });
      }
    }
    // Flush remaining
    if (pendingTools.length > 0 && currentAgent) {
      currentAgent.segments!.push(...pendingTools);
    } else if (pendingTools.length > 0) {
      const firstTool = pendingTools.find(
        (seg): seg is { kind: "tool"; event: ToolEvent } => seg.kind === "tool",
      );
      currentAgent = {
        role: "assistant",
        content: "",
        segments: [],
        timestamp: firstTool?.event.timestamp || Date.now(),
      };
      if (!sawStoredStepMarkers) {
        startStep(undefined, currentAgent.timestamp || Date.now());
      }
      currentAgent.segments!.push(...pendingTools);
    }
    flushAgent();
    return processed;
  }, []);

  // Load messages when session changes (only if we have a session)
  const prevSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeSessionId) {
      // No session = new conversation, clear everything
      setMessages([]);
      setLiveSegments([]);
      prevSessionRef.current = null;
      return;
    }

    // If we just created this session (messages already in state from streaming), don't reload
    if (activeSessionId === prevSessionRef.current) return;
    prevSessionRef.current = activeSessionId;

    // Clear and reload from API
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
  }, [messages, liveSegments]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, [agentId]);

  // Core dispatch — opens WebSocket and sends a message
  const dispatchMessage = useCallback(async (messageText: string) => {
    const startTime = Date.now();

    // Un-queue this message in the transcript
    setMessages((prev) => {
      let found = false;
      return prev.map((m) => {
        if (!found && m.queued && m.content === messageText) {
          found = true;
          return { ...m, queued: false };
        }
        return m;
      });
    });

    setStreaming(true);
    setLiveSegments([]);
    setThinkingStart(startTime);

    // If no active session, create one with the first message.
    let sessionId = sessionIdRef.current;
    const isNewConversation = !sessionId;
    if (!sessionId) {
      try {
        const d = await api.createSession(agentId);
        if (d.session_id) {
          sessionId = d.session_id as string;
          sessionIdRef.current = sessionId;
          prevSessionRef.current = sessionId;
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

    // Close any previous connection before opening a new one
    if (wsRef.current) {
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      wsRef.current.onclose = null;
      wsRef.current.close();
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
      if (isNewConversation) {
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
            setLiveSegments([...segments]);
            break;
          }
          case "ToolStart": {
            const name =
              event.name || event.tool_name || event.tool_use_id || "tool";
            const ev: ToolEvent = {
              type: "start",
              name,
              id: event.tool_use_id || event.id,
              timestamp: Date.now(),
            };
            segments.push({ kind: "tool", event: ev });
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
              id: event.tool_use_id || event.id,
              success: event.success !== false,
              input_preview: event.input_preview || undefined,
              output_preview: event.output_preview || event.output || "",
              duration_ms: event.duration_ms,
              timestamp: Date.now(),
            };
            const segIdx = segments.findIndex(
              (s) =>
                s.kind === "tool" &&
                s.event.type === "start" &&
                ((completed.id && s.event.id === completed.id) ||
                  (!completed.id && s.event.name === name)),
            );
            if (segIdx >= 0)
              segments[segIdx] = { kind: "tool", event: completed };
            else segments.push({ kind: "tool", event: completed });
            setLiveSegments([...segments]);
            break;
          }
          case "StepStart": {
            // Count per-response, not session-level
            const step = countStepSegments(segments) + 1;
            segments.push({ kind: "step", step });
            setLiveSegments([...segments]);
            break;
          }
          case "IdeaActivity":
          case "MemoryActivity": {
            const label = event.action === "stored"
              ? `Stored: ${event.key || "idea"}`
              : `Recalled: ${event.key || "idea"}`;
            segments.push({ kind: "status", text: label });
            setLiveSegments([...segments]);
            break;
          }
          case "DelegateStart": {
            segments.push({ kind: "status", text: `Delegating to ${event.worker_name || "agent"}...` });
            setLiveSegments([...segments]);
            break;
          }
          case "DelegateComplete": {
            segments.push({ kind: "status", text: `${event.worker_name || "Agent"} finished: ${event.outcome || "done"}` });
            setLiveSegments([...segments]);
            break;
          }
          case "Status":
          case "Compacted": {
            break;
          }
          case "Complete":
          case "done": {
            if (!event.done && event.type === "Complete") break;
            done = true;
            const endTime = Date.now();
            const duration = formatDuration(startTime, endTime);
            const hasContent = fullText || segments.length > 0;
            if (hasContent) {
              const promptTok = event.prompt_tokens || 0;
              const completionTok = event.completion_tokens || 0;
              const stepCount = countStepSegments(segments) || undefined;
              setMessages((prev) => {
                const msg: Message = {
                  role: "assistant",
                  content: fullText,
                  segments: segments.length > 0 ? [...segments] : undefined,
                  timestamp: endTime,
                  duration,
                  costUsd: event.cost_usd || undefined,
                  stepCount,
                  tokenUsage:
                    promptTok || completionTok
                      ? { prompt: promptTok, completion: completionTok }
                      : undefined,
                };
                // Insert before any queued messages so transcript stays in order
                const firstQueued = prev.findIndex((m) => m.queued);
                if (firstQueued >= 0) {
                  return [...prev.slice(0, firstQueued), msg, ...prev.slice(firstQueued)];
                }
                return [...prev, msg];
              });
            }
            setStreaming(false);
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
      setLiveSegments([]);
      setThinkingStart(null);
    };
    ws.onclose = () => {
      if (!done && (fullText || segments.length > 0)) {
        const endTime = Date.now();
        setMessages((prev) => {
          const msg: Message = {
            role: "assistant",
            content: fullText,
            segments: segments.length > 0 ? [...segments] : undefined,
            timestamp: endTime,
            duration: formatDuration(startTime, endTime),
          };
          const firstQueued = prev.findIndex((m) => m.queued);
          if (firstQueued >= 0) {
            return [...prev.slice(0, firstQueued), msg, ...prev.slice(firstQueued)];
          }
          return [...prev, msg];
        });
      }
      setStreaming(false);
      setLiveSegments([]);
      setThinkingStart(null);
    };
  }, [token, agentId, agentName, setSession, sessionPrompts, sessionTask, attachedFiles]);

  // Ref to latest dispatchMessage for queue processing
  const dispatchRef = useRef(dispatchMessage);
  dispatchRef.current = dispatchMessage;

  // Clean up WebSocket on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  // Process queued messages when streaming ends
  useEffect(() => {
    if (streaming) return;
    if (messageQueueRef.current.length === 0) return;
    const next = messageQueueRef.current.shift()!;
    const timer = setTimeout(() => dispatchRef.current(next), 100);
    return () => clearTimeout(timer);
  }, [streaming]);

  // User-facing send handler
  const handleSend = useCallback(() => {
    if (!input.trim() || !token) return;

    const messageText = input;
    setInput("");
    requestAnimationFrame(() => inputRef.current?.focus());

    // Add to transcript — mark as queued if currently streaming
    setMessages((prev) => [...prev, {
      role: "user",
      content: messageText,
      timestamp: Date.now(),
      queued: streaming || undefined,
    }]);

    if (streaming) {
      messageQueueRef.current.push(messageText);
      return;
    }

    void dispatchMessage(messageText);
  }, [input, streaming, token, dispatchMessage]);

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
    el.style.height = `${Math.min(el.scrollHeight, 360)}px`;
  };

  if (!agentId) return null;

  const runningToolName = currentRunningToolName(liveSegments);
  const liveStepCount = countStepSegments(liveSegments);
  const liveLastSegment = liveSegments[liveSegments.length - 1];
  const showLiveThinking =
    streaming &&
    (runningToolName != null ||
      liveSegments.length === 0 ||
      liveLastSegment?.kind === "tool" ||
      liveLastSegment?.kind === "step");

  return (
    <div
      className={`asv ${dragOver ? "asv--dragover" : ""}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
    >
      {/* Session tabs */}
      <div className="asv-session-tabs" role="tablist">
        <button
          className="asv-session-new-btn"
          onClick={handleNewConversation}
          title="New session (⌘N)"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M6 2.5v7M2.5 6h7" /></svg>
          New
        </button>
        <div className="asv-session-tabs-divider" />
        {sessions.map((s) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={s.id === activeSessionId}
            className={`asv-session-tab${s.id === activeSessionId ? " active" : ""}`}
            onClick={() => handleSelectSession(s.id)}
            title={s.first_message || s.name || s.id}
          >
            {sessionLabel(s)}
          </button>
        ))}
      </div>

      {/* Message transcript */}
      <div className="asv-messages">
        {messages.length === 0 && !streaming && (
          <div className="asv-empty">
            <div className="asv-empty-icon">
              <RoundAvatar name={agentName} size={40} />
            </div>
            <div className="asv-empty-title">{displayName}</div>
            <div className="asv-empty-hint">
              {activeSessionId
                ? "Continue this conversation."
                : "Start a new session."}
            </div>
            {!activeSessionId && (
              <div className="asv-empty-suggestions">
                {["What can you do?", "Show me your tools", "What quests are open?"].map((q) => (
                  <button
                    key={q}
                    className="asv-empty-suggestion"
                    onClick={() => {
                      setMessages((prev) => [...prev, { role: "user", content: q, timestamp: Date.now() }]);
                      void dispatchMessage(q);
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageItem
            key={i}
            msg={msg}
            agentName={agentName}
            userName={userName}
            userAvatarUrl={userAvatarUrl}
          />
        ))}

        {/* Live streaming — segments in order */}
        {streaming && (
          <div className="asv-msg asv-msg-assistant asv-msg-streaming">
            <div className="asv-msg-avatar">
              <RoundAvatar name={agentName} size={24} />
            </div>
            <div className="asv-msg-body">
              <SegmentRenderer segments={liveSegments} live />
              {showLiveThinking && <ThinkingStatus toolName={runningToolName} />}
              {thinkingStart && (
                <div className="asv-msg-footer">
                  <span>{formatTime(thinkingStart)}</span>
                  <ThinkingTimer start={thinkingStart} />
                  {liveStepCount > 0 && <span>{formatStepCount(liveStepCount)}</span>}
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEnd} />
      </div>

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

      {/* Input box */}
      <div className="asv-composer">
        <div
          className={`asv-composer-inner ${streaming ? "asv-composer-busy" : ""}`}
        >
          <div className="asv-composer-body">
            {/* Attached chips — always visible */}
            {(sessionPrompts.length > 0 || sessionTask || attachedFiles.length > 0) && (
              <div className="asv-attach-chips">
                {sessionPrompts.map((p, i) => (
                  <span key={`p-${i}`} className="asv-attach-chip">
                    {p}
                    <span className="asv-attach-chip-x" onClick={() => setSessionPrompts((prev) => prev.filter((_, j) => j !== i))}>×</span>
                  </span>
                ))}
                {sessionTask && (
                  <span className="asv-attach-chip">
                    {sessionTask.name}
                    <span className="asv-attach-chip-x" onClick={() => setSessionTask(null)}>×</span>
                  </span>
                )}
                {attachedFiles.map((f, i) => (
                  <span key={`f-${i}`} className="asv-attach-chip">
                    {f.name}
                    <span className="asv-attach-chip-x" onClick={() => setAttachedFiles((prev) => prev.filter((_, j) => j !== i))}>×</span>
                  </span>
                ))}
              </div>
            )}
            <textarea
              ref={inputRef}
              className="asv-textarea"
              placeholder={
                streaming ? "Queue a message..." : `Message ${displayName}...`
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
              rows={2}
            />
            {/* Footer — attach actions left, send right */}
            <div className="asv-composer-footer">
              <div className="asv-attach-row">
                <button className="asv-attach-btn" onClick={() => { setShowAttachPicker("prompt"); setActiveTagFilters([]); }} title="Attach idea (⌘P)">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M7 2v2M7 10v2M2 7h2M10 7h2M3.8 3.8l1.4 1.4M8.8 8.8l1.4 1.4M10.2 3.8l-1.4 1.4M5.2 8.8l-1.4 1.4" strokeLinecap="round" /></svg>
                </button>
                <button className="asv-attach-btn" onClick={() => setShowAttachPicker("quest")} title="Attach quest (⌘Q)">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M4 3h8M4 7h8M4 11h6M2 3v0M2 7v0M2 11v0" strokeLinecap="round" /></svg>
                </button>
                <button className="asv-attach-btn" onClick={() => fileInputRef.current?.click()} title="Attach file">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M7.5 2L4 5.5a2.12 2.12 0 003 3L10.5 5a3 3 0 00-4.24-4.24L2.5 4.5a4.24 4.24 0 006 6L12 7" /></svg>
                </button>
              </div>
              <button
                className={`asv-send ${input.trim() ? "ready" : ""} ${streaming && !input.trim() ? "busy" : ""}`}
                onClick={handleSend}
                disabled={!input.trim()}
              >
                {streaming && !input.trim() ? (
                  <svg className="asv-send-spinner" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="8" cy="8" r="6" strokeDasharray="28" strokeDashoffset="8" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M3 8h10M9.5 4.5L13 8l-3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                <span className="asv-send-label">Send</span>
              </button>
            </div>
          </div>
        </div>
        <div className="asv-composer-hint">
          <kbd>Enter</kbd>&nbsp;send&ensp;<kbd>Shift+Enter</kbd>&nbsp;newline
        </div>
      </div>
    </div>
  );
}
