import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import MessageItem from "@/components/session/MessageItem";
import type { Message } from "@/components/session/types";

describe("MessageItem", () => {
  afterEach(() => {
    cleanup();
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
});
