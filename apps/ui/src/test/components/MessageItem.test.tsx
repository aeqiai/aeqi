import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import MessageItem from "@/components/session/MessageItem";
import type { Message } from "@/components/session/types";
import { useDaemonStore } from "@/store/daemon";

describe("MessageItem", () => {
  afterEach(() => {
    cleanup();
    useDaemonStore.setState({ agents: [], entities: [] });
  });

  it("renders final assistant text without a synthetic thinking panel", () => {
    const msg: Message = {
      role: "assistant",
      content: "Final answer.",
      segments: [
        { kind: "step", step: 1 },
        { kind: "text", text: "Final answer." },
        { kind: "status", text: "Updating session metadata..." },
      ],
    };

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <MemoryRouter initialEntries={["/company/root-1/sessions"]}>
        <QueryClientProvider client={queryClient}>
          <MessageItem msg={msg} sessionCompanyId="root-1" />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText("Final answer.")).toBeInTheDocument();
    expect(screen.queryByText("Step 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Thought")).not.toBeInTheDocument();
    expect(screen.queryByText("Updating session metadata...")).not.toBeInTheDocument();
  });

  it("uses the canonical agent avatar fallback for agent messages", () => {
    useDaemonStore.setState({
      agents: [{ id: "agent-1", name: "Chief of Staff", status: "active" }] as never,
      entities: [],
    });

    renderMessage({
      role: "assistant",
      from_kind: "agent",
      from_id: "agent-1",
      content: "Agent reply.",
    });

    expect(screen.getAllByTitle("Chief of Staff").length).toBeGreaterThan(0);
  });

  it("does not render a generated placeholder for external senders without a real avatar", () => {
    const { container } = renderMessage({
      role: "user",
      from_kind: "user",
      from_id: "external-user",
      content: "hello over WhatsApp",
      transport: "whatsapp-baileys",
      sender: {
        id: "sender-1",
        display_name: "Luca",
        transport: "whatsapp-baileys",
        transport_id: "10712151793796@lid",
      },
    });

    expect(screen.getByText("Luca")).toBeInTheDocument();
    expect(container.querySelector(".asv-msg-author img, .asv-msg-author svg")).toBeNull();
  });
});

function renderMessage(msg: Message) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <MemoryRouter initialEntries={["/company/root-1/sessions"]}>
      <QueryClientProvider client={queryClient}>
        <MessageItem msg={msg} sessionCompanyId="root-1" />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
