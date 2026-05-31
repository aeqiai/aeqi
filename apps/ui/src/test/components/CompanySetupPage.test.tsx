import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CompanySetupPage from "@/pages/CompanySetupPage";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";

const {
  getBlueprints,
  getBlueprint,
  checkLaunchName,
  createCheckoutSession,
  startLaunch,
  goExternal,
} = vi.hoisted(() => ({
  getBlueprints: vi.fn(),
  getBlueprint: vi.fn(),
  checkLaunchName: vi.fn(),
  createCheckoutSession: vi.fn(),
  startLaunch: vi.fn(),
  goExternal: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    api: {
      ...(original.api as object),
      getBlueprints,
      getBlueprint,
      checkLaunchName,
      createCheckoutSession,
      startLaunch,
    },
  };
});

vi.mock("@/lib/navigation", () => ({
  goExternal,
}));

vi.mock("@/pages/companySetup/CompanySetupFlow", () => ({
  LaunchShellLoading: () => <div>Loading blueprint...</div>,
  LaunchShellError: ({ error }: { error: string | null }) => <div>{error}</div>,
  CompanySetupFlow: (props: {
    trustName: string;
    operations: "free" | "paid" | "sandbox";
    plan: string;
    adminSandboxAvailable?: boolean;
    onOperationsChange: (value: "free" | "paid" | "sandbox") => void;
    onLaunch: () => void;
  }) => (
    <div>
      <div data-testid="launch-state">
        {props.operations}:{props.plan}:{props.trustName}:
        {props.adminSandboxAvailable ? "admin" : "user"}
      </div>
      <button type="button" onClick={() => props.onOperationsChange("sandbox")}>
        Select sandbox
      </button>
      <button type="button" onClick={props.onLaunch}>
        Launch
      </button>
    </div>
  ),
}));

const blueprint = {
  slug: "personal-os",
  name: "First Company",
  seed_agents: [],
};

describe("CompanySetupPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getBlueprints.mockResolvedValue({ ok: true, blueprints: [blueprint] });
    getBlueprint.mockResolvedValue({ ok: true, blueprint });
    checkLaunchName.mockResolvedValue({ available: true });
    createCheckoutSession.mockResolvedValue({ url: "https://billing.example/checkout" });
    startLaunch.mockResolvedValue({ company_id: "ent_sandbox" });
    useAuthStore.setState({
      user: {
        id: "user-1",
        email: "ada@aeqi.ai",
        name: "Ada Founder",
        is_admin: true,
      },
    } as never);
    useDaemonStore.setState({
      entities: [],
      fetchEntities: vi.fn().mockResolvedValue(undefined),
    } as never);
  });

  it("does not auto-select the admin sandbox on /launch", async () => {
    render(
      <MemoryRouter initialEntries={["/launch"]}>
        <Routes>
          <Route path="/launch" element={<CompanySetupPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("launch-state")).toHaveTextContent("paid");
      expect(screen.getByTestId("launch-state")).toHaveTextContent("admin");
      expect(screen.getByTestId("launch-state")).toHaveTextContent("Ada Founder");
    });

    fireEvent.click(screen.getByRole("button", { name: "Launch" }));

    await waitFor(() => expect(createCheckoutSession).toHaveBeenCalled());
    expect(startLaunch).not.toHaveBeenCalled();
    expect(goExternal).toHaveBeenCalledWith("https://billing.example/checkout");
  });

  it("uses startLaunch only after an admin explicitly selects sandbox", async () => {
    render(
      <MemoryRouter initialEntries={["/launch"]}>
        <Routes>
          <Route path="/launch" element={<CompanySetupPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByTestId("launch-state");
    fireEvent.click(screen.getByRole("button", { name: "Select sandbox" }));
    fireEvent.click(screen.getByRole("button", { name: "Launch" }));

    await waitFor(() => expect(startLaunch).toHaveBeenCalled());
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });
});
