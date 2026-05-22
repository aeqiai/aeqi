import type { Meta, StoryObj } from "@storybook/react";
import SessionDetail from "./SessionDetail";
import type { Message } from "@/components/session/types";

const meta: Meta<typeof SessionDetail> = {
  title: "Primitives/Conversation/SessionDetail",
  component: SessionDetail,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Universal session detail pane — the right-adjacent transcript + composer column for every conversation surface (inbox, agent sessions, future channels). Owns ParticipantStrip + header + scrolling thread + composer chrome. Each surface adapts its data layer (Zustand inbox-store polling, WebSocket streaming, react-query polling) into the same prop contract; the primitive renders identically across them.",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof SessionDetail>;

const SAMPLE_MESSAGES: Message[] = [
  {
    role: "assistant",
    from_kind: "agent",
    content:
      "Hey — pulling the AEQI deploy postmortem now. Want me to start with what landed cleanly or what regressed?",
    timestamp: Date.now() - 1000 * 60 * 12,
  },
  {
    role: "user",
    from_kind: "user",
    content: "Regressions first. Skip the wins.",
    timestamp: Date.now() - 1000 * 60 * 11,
  },
  {
    role: "assistant",
    from_kind: "agent",
    content:
      "Two regressions: (1) the inbox composer briefly stacked over the thread on /me/inbox between the v0.41.0 deploy and the parity-v2 hotfix; (2) the AEQI EA's Telegram mention-gate let one off-topic message through during the rebrand window.",
    timestamp: Date.now() - 1000 * 60 * 10,
  },
];

const noopAsync = async () => {};

export const Empty: Story = {
  args: {
    sessionId: "s-empty",
    title: "AEQI EA",
    subtitle: "What's the next action on the cap-table close?",
    messages: [],
    onSend: noopAsync,
    composerPlaceholder: "Reply to AEQI EA…",
    emptyTitle: "No prior messages.",
    surface: "recessed",
  },
  render: (args) => (
    <div style={{ height: "80vh", display: "flex", flexDirection: "column" }}>
      <div className="inbox-pane-detail" style={{ flex: 1, position: "relative" }}>
        <SessionDetail {...args} />
      </div>
    </div>
  ),
};

export const WithMessages: Story = {
  args: {
    sessionId: "s-postmortem",
    title: "AEQI EA",
    subtitle: "AEQI deploy postmortem",
    messages: SAMPLE_MESSAGES,
    onSend: noopAsync,
    composerPlaceholder: "Reply to AEQI EA…",
    attachmentTypes: ["idea", "quest", "file"],
    agentId: "agent-aeqi-ea",
    surface: "recessed",
  },
  render: (args) => (
    <div style={{ height: "80vh", display: "flex", flexDirection: "column" }}>
      <div className="inbox-pane-detail" style={{ flex: 1, position: "relative" }}>
        <SessionDetail {...args} />
      </div>
    </div>
  ),
};

export const DecisionRequest: Story = {
  args: {
    sessionId: "s-decision",
    title: "AEQI EA",
    subtitle: "Should we hold the v0.50.0 release until the bundler upgrade lands?",
    messages: SAMPLE_MESSAGES.slice(0, 1),
    onSend: noopAsync,
    composerPlaceholder: "Reply to AEQI EA…",
    surface: "recessed",
  },
  render: (args) => (
    <div style={{ height: "80vh", display: "flex", flexDirection: "column" }}>
      <div className="inbox-pane-detail" style={{ flex: 1, position: "relative" }}>
        <SessionDetail {...args} />
      </div>
    </div>
  ),
};

export const Streaming: Story = {
  args: {
    sessionId: "s-streaming",
    title: "AEQI EA",
    messages: SAMPLE_MESSAGES,
    onSend: noopAsync,
    onStop: noopAsync,
    isStreaming: true,
    composerPlaceholder: "Message AEQI EA…",
    attachmentTypes: ["idea", "quest", "file"],
    surface: "recessed",
  },
  render: (args) => (
    <div style={{ height: "80vh", display: "flex", flexDirection: "column" }}>
      <div className="inbox-pane-detail" style={{ flex: 1, position: "relative" }}>
        <SessionDetail {...args} />
      </div>
    </div>
  ),
};
