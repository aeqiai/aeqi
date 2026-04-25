/**
 * Canonical tool list surfaced in the agent Tools tab. Order is stable —
 * the rail renders in this order, and the detail pane reads the same map.
 */

export interface ToolSpec {
  id: string;
  label: string;
  category: "shell" | "files" | "search" | "aeqi" | "web";
  description: string;
}

export const ALL_TOOLS: ToolSpec[] = [
  {
    id: "shell",
    label: "Shell",
    category: "shell",
    description:
      "Run bash commands inside the agent's sandbox. High-risk — grants arbitrary code execution on the agent's filesystem.",
  },
  {
    id: "read_file",
    label: "Read file",
    category: "files",
    description: "Read a file's contents by absolute path. Read-only, safe.",
  },
  {
    id: "write_file",
    label: "Write file",
    category: "files",
    description: "Create or overwrite a file at an absolute path. Mutates the filesystem.",
  },
  {
    id: "edit_file",
    label: "Edit file",
    category: "files",
    description: "Apply a targeted string replacement to an existing file.",
  },
  {
    id: "grep",
    label: "Grep",
    category: "search",
    description: "Regex search across files. Powered by ripgrep. Read-only.",
  },
  {
    id: "glob",
    label: "Glob",
    category: "search",
    description: "Find files by glob pattern (e.g. `**/*.tsx`). Read-only.",
  },
  {
    id: "ideas",
    label: "Ideas",
    category: "aeqi",
    description: "Search and store knowledge in the agent's idea graph.",
  },
  {
    id: "quests",
    label: "Quests",
    category: "aeqi",
    description: "List, create, and close quests — the agent's work items.",
  },
  {
    id: "agents",
    label: "Agents",
    category: "aeqi",
    description: "Inspect other agents in the tree and spawn children.",
  },
  {
    id: "events",
    label: "Events",
    category: "aeqi",
    description: "Configure pattern-matched events that fire on agent activity.",
  },
  {
    id: "question.ask",
    label: "Ask the director",
    category: "aeqi",
    description:
      "When enabled, this agent can fire question.ask to surface a question to your home-page inbox. Off by default — flip on for agents you trust to ask sparingly.",
  },
  {
    id: "code",
    label: "Code",
    category: "aeqi",
    description: "Navigate code via LSP-like symbol queries.",
  },
  {
    id: "web_search",
    label: "Web search",
    category: "web",
    description: "Search the web and get result summaries. Requires network.",
  },
  {
    id: "web_fetch",
    label: "Web fetch",
    category: "web",
    description: "Fetch a URL and get the rendered content. Requires network.",
  },
];

export const TOOL_BY_ID: Record<string, ToolSpec> = Object.fromEntries(
  ALL_TOOLS.map((t) => [t.id, t]),
);
