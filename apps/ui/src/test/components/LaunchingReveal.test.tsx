import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { LaunchingReveal } from "@/components/LaunchingReveal";
import { useUIStore } from "@/store/ui";

const { getLaunchStatus } = vi.hoisted(() => ({
  getLaunchStatus: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    api: {
      ...(original.api as object),
      getLaunchStatus,
    },
  };
});

describe("LaunchingReveal", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useUIStore.setState({ activeEntity: "" } as never);
  });

  it("shows the launched TRUST and live website handoff when the placement is ready", async () => {
    getLaunchStatus.mockResolvedValue({
      placement_status: "ready",
      display_name: "Janus TRUST",
      trust_address: "9AlphaTrust111111111111111111111111111111111",
      milestones: {},
    });

    render(
      <MemoryRouter initialEntries={["/launch?launch=ent_123"]}>
        <Routes>
          <Route
            path="/launch"
            element={<LaunchingReveal trustId="ent_123" fallbackDisplayName="Janus TRUST" />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("The TRUST exists and the public website shell is live."),
    ).toBeInTheDocument();
    expect(screen.getByText("Website")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Website" })).toHaveAttribute(
      "href",
      "/janus-trust",
    );
    expect(screen.getByRole("link", { name: "Trust tools" })).toHaveAttribute(
      "href",
      "/trust/9AlphaTrust111111111111111111111111111111111",
    );
    await waitFor(() =>
      expect(useUIStore.getState().activeEntity).toBe(
        "9AlphaTrust111111111111111111111111111111111",
      ),
    );
    expect(getLaunchStatus).toHaveBeenCalledWith("ent_123");
  });
});
