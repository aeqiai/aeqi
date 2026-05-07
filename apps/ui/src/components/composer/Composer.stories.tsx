import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import Composer, { type ComposerFile } from "./Composer";

const meta: Meta<typeof Composer> = {
  title: "Primitives/Conversation/Composer",
  component: Composer,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Canonical conversation primitive. Subsumes the five surface-specific composers (chat, inbox, channels, idea-comments, shell row) into one. Capabilities are opt-in via props: slash palette, ⌘P/⌘Q shortcuts, ArrowUp scrollback, attached chips, drag-drop, streaming Stop/Queue, kbd ribbon, @mention autocomplete, surface-specific extra actions. Enter sends, ⇧⏎ inserts newline.",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof Composer>;

/* ── Minimal — inbox-shape (card variant, no attachments, no slash) ── */

function MinimalDemo() {
  const [v, setV] = useState("");
  return (
    <div style={{ width: 600, background: "var(--color-card-subtle)" }}>
      <Composer
        variant="card"
        value={v}
        onChange={setV}
        onSend={() => alert(`send: ${v}`)}
        placeholder="Reply…"
      />
    </div>
  );
}

export const Minimal: Story = {
  name: "Minimal (inbox-shape)",
  render: () => <MinimalDemo />,
};

/* ── Full — chat-shape (shell variant, all attachments, slash, history) ── */

function FullDemo() {
  const [v, setV] = useState("");
  const [ideas, setIdeas] = useState<string[]>([]);
  const [quest, setQuest] = useState<{ id: string; name: string } | null>(null);
  const [files, setFiles] = useState<ComposerFile[]>([]);
  return (
    <div style={{ width: 720, background: "var(--bg-base)" }}>
      <Composer
        variant="shell"
        value={v}
        onChange={setV}
        onSend={() => alert(`send: ${v}`)}
        placeholder="Message agent..."
        attachmentTypes={["idea", "quest", "file"]}
        attachedIdeas={ideas}
        setAttachedIdeas={setIdeas}
        attachedQuest={quest}
        setAttachedQuest={setQuest}
        attachedFiles={files}
        setAttachedFiles={setFiles}
        onAttachClick={(kind) => alert(`open ${kind} picker`)}
        onReadFiles={() => alert("read files")}
        historySource={["first prior message", "second prior message"]}
      />
    </div>
  );
}

export const Full: Story = {
  name: "Full (chat-shape)",
  render: () => <FullDemo />,
};

/* ── Streaming — Stop button while busy ── */

function StreamingDemo() {
  const [v, setV] = useState("type a follow-up while streaming");
  return (
    <div style={{ width: 720, background: "var(--bg-base)" }}>
      <Composer
        variant="shell"
        value={v}
        onChange={setV}
        onSend={() => alert(`queued: ${v}`)}
        onStop={() => alert("stop streaming")}
        streaming
        attachmentTypes={["idea", "quest", "file"]}
        onAttachClick={() => {}}
        onReadFiles={() => {}}
      />
    </div>
  );
}

export const Streaming: Story = {
  name: "Streaming (Stop / Queue)",
  render: () => <StreamingDemo />,
};

/* ── With attachments — chips above the input ── */

function WithAttachmentsDemo() {
  const [v, setV] = useState("");
  const [ideas, setIdeas] = useState<string[]>(["P1: ship the wave"]);
  const [quest, setQuest] = useState<{ id: string; name: string } | null>({
    id: "q-123",
    name: "Migrate composers to canonical primitive",
  });
  const [files, setFiles] = useState<ComposerFile[]>([
    { name: "audit.md", content: "...", size: 2048 },
  ]);
  return (
    <div style={{ width: 720, background: "var(--bg-base)" }}>
      <Composer
        variant="shell"
        value={v}
        onChange={setV}
        onSend={() => alert(`send: ${v}`)}
        attachmentTypes={["idea", "quest", "file"]}
        attachedIdeas={ideas}
        setAttachedIdeas={setIdeas}
        attachedQuest={quest}
        setAttachedQuest={setQuest}
        attachedFiles={files}
        setAttachedFiles={setFiles}
        onAttachClick={() => {}}
        onReadFiles={() => {}}
      />
    </div>
  );
}

export const WithAttachments: Story = {
  name: "With attachments",
  render: () => <WithAttachmentsDemo />,
};

/* ── With mentions — channel-shape ── */

function WithMentionsDemo() {
  const [v, setV] = useState("");
  return (
    <div style={{ width: 600, background: "var(--color-card-subtle)" }}>
      <Composer
        variant="card"
        value={v}
        onChange={setV}
        onSend={() => alert(`send: ${v}`)}
        placeholder="Message the channel — @ to mention, Shift+Enter for newline"
        mentionables={[
          { kind: "agent", id: "agent-ceo", label: "CEO Agent", token: "ceo" },
          { kind: "agent", id: "agent-cto", label: "CTO Agent", token: "cto" },
          { kind: "user", id: "user-luca", label: "Luca", token: "luca" },
          { kind: "role", id: "role-ea", label: "EA", token: "ea" },
        ]}
      />
    </div>
  );
}

export const WithMentions: Story = {
  name: "With @mentions (channel-shape)",
  parameters: {
    docs: {
      description: {
        story:
          "Type `@` to open the mention autocomplete. Tab/Enter inserts a canonical `@<kind>:<id>` token (matching `crates/aeqi-orchestrator/src/mentions.rs`).",
      },
    },
  },
  render: () => <WithMentionsDemo />,
};
