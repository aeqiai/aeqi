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

  it("shows the launched COMPANY and live website handoff when the placement is ready", async () => {
    getLaunchStatus.mockResolvedValue({
      placement_status: "ready",
      display_name: "Janus COMPANY",
      email_address: "hello@janus-company.aeqi.ai",
      company_address: "9AlphaCompany111111111111111111111111111111111",
      milestones: {},
    });

    render(
      <MemoryRouter initialEntries={["/launch?launch=ent_123"]}>
        <Routes>
          <Route
            path="/launch"
            element={<LaunchingReveal companyId="ent_123" fallbackDisplayName="Janus COMPANY" />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("The COMPANY exists and the public website shell is live."),
    ).toBeInTheDocument();
    expect(screen.getByText("Website")).toBeInTheDocument();
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByText("hello@janus-company.aeqi.ai")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open website" })).toHaveAttribute(
      "href",
      "https://janus-company.aeqi.ai/",
    );
    expect(screen.getByRole("link", { name: "COMPANY tools" })).toHaveAttribute(
      "href",
      "/company/9AlphaCompany111111111111111111111111111111111",
    );
    await waitFor(() => expect(useUIStore.getState().activeEntity).toBe("ent_123"));
    expect(getLaunchStatus).toHaveBeenCalledWith("ent_123");
  });

  it("does not claim website or Solana completion until the company address exists", async () => {
    getLaunchStatus.mockResolvedValue({
      placement_status: "ready",
      display_name: "Janus COMPANY",
      email_address: null,
      company_address: null,
      milestones: {
        creating_company: { reached: true },
        loading_roles: { reached: true },
        spawning_agent: { reached: true },
      },
    });

    render(
      <MemoryRouter initialEntries={["/launch?launch=ent_123"]}>
        <Routes>
          <Route
            path="/launch"
            element={<LaunchingReveal companyId="ent_123" fallbackDisplayName="Janus COMPANY" />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Janus COMPANY runtime is ready.")).toBeInTheDocument();
    expect(screen.getByText(/On-chain COMPANY identity is still confirming/i)).toBeInTheDocument();
    expect(
      screen.queryByText("The COMPANY exists and the public website shell is live."),
    ).toBeNull();
    expect(screen.queryByText("Website")).toBeNull();
    expect(screen.queryByRole("link", { name: "Open website" })).toBeNull();
    expect(useUIStore.getState().activeEntity).toBe("");
  });
});
