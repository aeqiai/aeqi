import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrimitivePreview } from "@/components/markdown/PrimitivePreview";

vi.mock("@/lib/api", () => ({
  api: {
    getAgents: vi.fn(),
    getIdeasByIds: vi.fn(),
    getEvent: vi.fn(),
    getQuest: vi.fn(),
  },
}));

import { api } from "@/lib/api";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("PrimitivePreview", () => {
  it("renders event refs from the single-event endpoint", async () => {
    vi.mocked(api.getEvent).mockResolvedValue({
      ok: true,
      event: {
        id: "event-1",
        agent_id: "root-1",
        name: "Morning kickoff",
        pattern: "session:start",
        idea_ids: [],
        enabled: true,
        cooldown_secs: 0,
        fire_count: 0,
        total_cost_usd: 0,
        system: false,
      },
    } as any);

    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/root-1/sessions"]}>
          <Routes>
            <Route path=":agentId/:tab" element={<PrimitivePreview kind="event" id="event-1" />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByText("Morning kickoff")).toBeInTheDocument();
    });
    expect(screen.getByText("session:start")).toBeInTheDocument();
  });

  it("renders quest refs from the wrapped quest payload", async () => {
    vi.mocked(api.getQuest).mockResolvedValue({
      ok: true,
      quest: {
        id: "quest-1",
        subject: "Ship the preview cards",
        description: "",
        status: "in_progress",
        priority: "normal",
        agent_id: "root-1",
        labels: [],
        cost_usd: 0,
        created_at: "2026-04-23T00:00:00Z",
      },
    } as any);

    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/root-1/sessions"]}>
          <Routes>
            <Route path=":agentId/:tab" element={<PrimitivePreview kind="quest" id="quest-1" />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByText("Ship the preview cards")).toBeInTheDocument();
    });
    expect(screen.getByText("in_progress")).toBeInTheDocument();
  });
});
