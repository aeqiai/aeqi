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

  it("automatically enters the launched TRUST when the placement is ready", async () => {
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
          <Route path="/trust/:trustAddress" element={<div>Trust shell</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Trust shell")).toBeInTheDocument();
    await waitFor(() =>
      expect(useUIStore.getState().activeEntity).toBe(
        "9AlphaTrust111111111111111111111111111111111",
      ),
    );
    expect(getLaunchStatus).toHaveBeenCalledWith("ent_123");
  });
});
