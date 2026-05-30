import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { LAUNCH_PLANS } from "@/lib/pricing";
import type { SingleBlueprint } from "@/lib/types";
import { TrustSetupFlow } from "@/pages/trustSetup/TrustSetupFlow";

const blueprint: SingleBlueprint = {
  slug: "solo-founder",
  name: "Solo Founder",
  seed_agents: [],
};

const baseProps = {
  blueprint,
  blueprintPath: "/blueprints/solo-founder",
  submitError: null,
  loadError: null,
  trustName: "Janus",
  nameHint: "Name is available.",
  operations: "paid" as const,
  plan: "growth" as const,
  selectedLaunchPlan: LAUNCH_PLANS[0],
  canSubmit: true,
  submitting: false,
  onTrustNameChange: vi.fn(),
  onOperationsChange: vi.fn(),
  onPlanChange: vi.fn(),
  onLaunch: vi.fn(),
};

describe("TrustSetupFlow", () => {
  it("shows an outside-card back affordance when a returning user's TRUST path is provided", () => {
    render(
      <MemoryRouter>
        <TrustSetupFlow {...baseProps} exitHref="/trust/trust-1" />
      </MemoryRouter>,
    );

    const exitNav = screen.getByRole("navigation", { name: "Launch exit" });
    const backButton = within(exitNav).getByRole("button", { name: "Back" });

    expect(backButton.closest(".launch-flow-card")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Back" })).toHaveLength(2);
    expect(screen.getByText(/One launch binds identity, agents, quests/i)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Launch sequence" })).toBeInTheDocument();
    expect(screen.getByText(/Create the company container/i)).toBeInTheDocument();
  });

  it("falls back to the TRUST path when opened without app history", async () => {
    window.history.replaceState({ idx: 0 }, "", "/launch");

    render(
      <MemoryRouter initialEntries={["/launch"]}>
        <Routes>
          <Route
            path="/launch"
            element={<TrustSetupFlow {...baseProps} exitHref="/trust/trust-1" />}
          />
          <Route path="/trust/trust-1" element={<div>Returned to TRUST</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Launch exit" })).getByRole("button"),
    );

    expect(await screen.findByText("Returned to TRUST")).toBeInTheDocument();
  });

  it("uses the browser's previous app route when one exists", async () => {
    window.history.replaceState({ idx: 1 }, "", "/launch");

    render(
      <MemoryRouter initialEntries={["/trust/source", "/launch"]} initialIndex={1}>
        <Routes>
          <Route path="/trust/source" element={<div>Previous TRUST route</div>} />
          <Route
            path="/launch"
            element={<TrustSetupFlow {...baseProps} exitHref="/trust/trust-1" />}
          />
          <Route path="/trust/trust-1" element={<div>Fallback TRUST route</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Launch exit" })).getByRole("button"),
    );

    await waitFor(() => expect(screen.getByText("Previous TRUST route")).toBeInTheDocument());
    expect(screen.queryByText("Fallback TRUST route")).not.toBeInTheDocument();
  });

  it("keeps the launch flow closed when no returning TRUST path is provided", () => {
    render(
      <MemoryRouter>
        <TrustSetupFlow {...baseProps} exitHref={null} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });

  it("shows the Sandbox operations option only when admin sandbox is available", () => {
    const { rerender } = render(
      <MemoryRouter>
        <TrustSetupFlow {...baseProps} exitHref={null} adminSandboxAvailable={false} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("radio", { name: /Admin sandbox/i })).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <TrustSetupFlow {...baseProps} operations="sandbox" exitHref={null} adminSandboxAvailable />
      </MemoryRouter>,
    );

    expect(screen.getByRole("radio", { name: /Admin sandbox/i })).toBeChecked();
    expect(screen.getByText("No Stripe checkout")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Launch admin sandbox/i })).toBeInTheDocument();
  });
});
