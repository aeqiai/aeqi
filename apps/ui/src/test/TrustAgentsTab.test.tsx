import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import TrustAgentsTab from "@/components/TrustAgentsTab";
import { api } from "@/lib/api";
import { useDaemonStore } from "@/store/daemon";

describe("TrustAgentsTab", () => {
  beforeEach(() => {
    vi.spyOn(api, "getRoles").mockResolvedValue({ ok: true, roles: [], edges: [] });
    useDaemonStore.setState({
      entities: [
        {
          id: "root-1",
          name: "Root",
          type: "trust",
          status: "active",
          created_at: "2026-05-22T00:00:00Z",
          trust_address: "root-1",
        },
      ],
      agents: [
        {
          id: "janus",
          name: "Janus",
          status: "active",
          trust_id: "root-1",
          model: "gpt-5",
          created_at: "2026-05-22T00:00:00Z",
        },
      ] as never,
      quests: [],
      events: [],
      workerEvents: [],
      initialLoaded: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("places the search toolbar directly below the title row", () => {
    render(
      <MemoryRouter initialEntries={["/trust/root-1/agents"]}>
        <Routes>
          <Route path="/trust/:trustAddress/agents" element={<TrustAgentsTab trustId="root-1" />} />
        </Routes>
      </MemoryRouter>,
    );

    const heading = screen.getByRole("heading", { name: /Agents/ });
    const search = screen.getByPlaceholderText("Search agents");
    const snapshot = screen.getByRole("region", { name: "Snapshot" });

    expect(search.closest(".trust-agents-toolbar")).not.toBeNull();
    expect(heading.compareDocumentPosition(search)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(search.compareDocumentPosition(snapshot)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
