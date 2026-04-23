import { beforeEach, describe, expect, it } from "vitest";
import { createDraftId, useChatStore } from "@/store/chat";

describe("chat store draft routing", () => {
  beforeEach(() => {
    useChatStore.setState({
      pendingMessageByAgent: {},
      queuedDraftsBySession: {},
      sessionsByAgent: {},
    } as never);
  });

  it("keeps pending drafts scoped to the originating agent", () => {
    const draft = { id: createDraftId(), text: "hello" };
    useChatStore.getState().setPendingMessage("agent-a", draft);

    expect(useChatStore.getState().consumePendingMessage("agent-b")).toBeNull();
    expect(useChatStore.getState().consumePendingMessage("agent-a")).toEqual(draft);
    expect(useChatStore.getState().consumePendingMessage("agent-a")).toBeNull();
  });

  it("keeps queued drafts scoped to the active session and preserves order", () => {
    const first = { id: createDraftId(), text: "first" };
    const second = { id: createDraftId(), text: "second" };

    useChatStore.getState().queueDraft("session-1", first);
    useChatStore.getState().queueDraft("session-1", second);

    expect(useChatStore.getState().consumeQueuedDraft("session-2")).toBeNull();
    expect(useChatStore.getState().consumeQueuedDraft("session-1")).toEqual(first);
    expect(useChatStore.getState().consumeQueuedDraft("session-1")).toEqual(second);
    expect(useChatStore.getState().consumeQueuedDraft("session-1")).toBeNull();
  });
});
