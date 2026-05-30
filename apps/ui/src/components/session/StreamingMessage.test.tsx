import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import StreamingMessage from "./StreamingMessage";

describe("StreamingMessage", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders active processing participants inside the single streaming card", () => {
    const { container } = render(
      <StreamingMessage
        agentName="Builder"
        liveParticipants={[
          { id: "agent-1", name: "Builder", kind: "agent" },
          { id: "worker-1", name: "Researcher", kind: "worker" },
        ]}
        liveSegments={[
          {
            kind: "tool",
            event: { type: "start", name: "quests", timestamp: 1 },
          },
        ]}
        thinkingStart={1000}
        streaming
      />,
    );

    expect(screen.getByLabelText("Active session processing")).toBeInTheDocument();
    expect(screen.getByText("Processing")).toBeInTheDocument();
    expect(screen.getByText("Builder")).toBeInTheDocument();
    expect(screen.getByText("Researcher")).toBeInTheDocument();
    expect(screen.getByText("Quests...")).toBeInTheDocument();
    expect(container.querySelectorAll(".asv-msg-streaming")).toHaveLength(1);
  });

  it("does not render when streaming is false", () => {
    const { container } = render(
      <StreamingMessage
        agentName="Builder"
        liveSegments={[]}
        thinkingStart={null}
        streaming={false}
      />,
    );

    expect(container.firstChild).toBeNull();
  });
});
