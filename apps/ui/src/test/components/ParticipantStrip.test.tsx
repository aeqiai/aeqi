import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { apiRequest } from "@/api/client";
import ParticipantStrip from "@/components/sessions/ParticipantStrip";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";

vi.mock("@/api/client", () => ({
  apiRequest: vi.fn(),
}));

describe("ParticipantStrip", () => {
  beforeEach(() => {
    vi.mocked(apiRequest).mockResolvedValue({
      ok: true,
      participants: [
        { identity_id: "agent-1", identity_kind: "agent", name: "raw agent" },
        { identity_id: "user-1", identity_kind: "user", name: "raw user" },
      ],
    });
    useDaemonStore.setState({
      entities: [
        {
          id: "trust-1",
          name: "Root",
          type: "trust",
          status: "active",
          created_at: "2026-05-30T00:00:00Z",
          trust_address: "root-1",
        },
      ],
      agents: [
        {
          id: "agent-1",
          name: "Builder",
          avatar: "/builder.png",
          status: "active",
          trust_id: "trust-1",
        },
      ],
    });
    useAuthStore.setState({
      user: {
        id: "user-1",
        email: "director@example.com",
        name: "Director",
        avatar_url: "/director.png",
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("hydrates participant names and marks active agents as processing", async () => {
    render(
      <MemoryRouter>
        <ParticipantStrip
          sessionId="session-1"
          trustId="trust-1"
          activeParticipantIds={["agent-1"]}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith("/sessions/session-1/participants");
    });

    expect(await screen.findByAltText("Builder")).toBeInTheDocument();
    expect(screen.getByAltText("Director")).toBeInTheDocument();
    const active = screen.getByLabelText("Builder is processing");
    expect(active).toHaveClass("is-processing");
    expect(screen.queryByLabelText("Director is processing")).not.toBeInTheDocument();
  });
});
