import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Inbox from "@/components/inbox/Inbox";
import { useDaemonStore } from "@/store/daemon";
import { useInboxStore } from "@/store/inbox";
import type { InboxItem } from "@/lib/api";

function makeItem(sessionId: string, agentName = "alpha"): InboxItem {
  return {
    session_id: sessionId,
    agent_id: `agent-${sessionId}`,
    agent_name: agentName,
    root_agent_id: `agent-${sessionId}`,
    session_name: `session ${sessionId}`,
    awaiting_subject: `subject for ${sessionId}`,
    awaiting_at: "2026-04-25T10:00:00Z",
    last_agent_message: `excerpt for ${sessionId}`,
  };
}

function renderInbox(heading = "good afternoon, alex") {
  return render(
    <MemoryRouter>
      <Inbox heading={heading} />
    </MemoryRouter>,
  );
}

describe("Inbox", () => {
  beforeEach(() => {
    // Stub fetchInbox so the mount effect doesn't hit the network during
    // tests. Each test seeds the store directly.
    useInboxStore.setState({
      items: [],
      loading: false,
      error: null,
      lastFetchedAt: Date.now(),
      pendingDismissal: new Set<string>(),
      fetchInbox: vi.fn().mockResolvedValue(undefined),
    });
    useDaemonStore.setState({ wsConnected: true } as never);
  });

  afterEach(() => {
    document.title = "";
  });

  it("renders the empty state when there are no items", () => {
    renderInbox();
    // The bespoke empty-state title (Exo 2 lowercase).
    expect(screen.getByText("you're caught up")).toBeInTheDocument();
    // The eyebrow flips from "N AWAITING" to "CAUGHT UP" — uppercase
    // mono. (The empty-state title is lowercase, so an exact match
    // disambiguates from the eyebrow.)
    expect(screen.getByText("CAUGHT UP")).toBeInTheDocument();
  });

  it("renders one row per visible inbox item", () => {
    useInboxStore.setState({
      items: [makeItem("a"), makeItem("b"), makeItem("c")],
    });
    renderInbox();
    const rows = screen.getAllByTestId("inbox-row");
    expect(rows).toHaveLength(3);
    expect(screen.getByText("subject for a")).toBeInTheDocument();
    expect(screen.getByText("subject for c")).toBeInTheDocument();
  });

  it("shows the awaiting count in the eyebrow", () => {
    useInboxStore.setState({ items: [makeItem("a"), makeItem("b")] });
    renderInbox();
    expect(screen.getByText(/2 AWAITING/)).toBeInTheDocument();
  });

  it("hides items that are currently in pendingDismissal", () => {
    useInboxStore.setState({
      items: [makeItem("a"), makeItem("b")],
      pendingDismissal: new Set<string>(["a"]),
    });
    renderInbox();
    const rows = screen.getAllByTestId("inbox-row");
    expect(rows).toHaveLength(1);
    expect(screen.queryByText("subject for a")).not.toBeInTheDocument();
    expect(screen.getByText("subject for b")).toBeInTheDocument();
  });

  it("renders the greeting passed in via prop", () => {
    renderInbox("good morning, alex");
    expect(screen.getByText("good morning, alex")).toBeInTheDocument();
  });

  it("sets document.title to (N) inbox · æqi when items are pending", () => {
    useInboxStore.setState({ items: [makeItem("a"), makeItem("b")] });
    renderInbox();
    expect(document.title).toBe("(2) inbox · æqi");
  });

  it("sets document.title to inbox · æqi when caught up", () => {
    useInboxStore.setState({ items: [] });
    renderInbox();
    expect(document.title).toBe("inbox · æqi");
  });

  it("row is a button — clicking navigates to the source session", () => {
    useInboxStore.setState({ items: [makeItem("a")] });
    renderInbox();
    const row = screen.getByTestId("inbox-row");
    // Native <button>; no aria-expanded/aria-controls now that the
    // accordion is gone. Tag check is enough.
    expect(row.tagName).toBe("BUTTON");
    expect(row).not.toHaveAttribute("aria-expanded");
  });

  it("renders the loading skeleton on first paint", () => {
    useInboxStore.setState({ loading: true, lastFetchedAt: null });
    const { container } = renderInbox();
    // Skeleton renders 3 rows; assert the wrapper exists.
    const skeleton = container.querySelector(".inbox-skeleton");
    expect(skeleton).not.toBeNull();
    expect(
      within(skeleton as HTMLElement).getAllByRole("generic", { hidden: true }).length,
    ).toBeGreaterThan(0);
  });
});
