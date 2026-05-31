import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { LAUNCH_PLANS } from "@/lib/pricing";
import type { SingleBlueprint } from "@/lib/types";
import { CompanySetupFlow } from "@/pages/companySetup/CompanySetupFlow";

const blueprint: SingleBlueprint = {
  slug: "solo-founder",
  name: "Solo Founder",
  seed_agents: [],
};

const baseProps = {
  blueprint,
  blueprintPath: "/templates/solo-founder",
  submitError: null,
  loadError: null,
  trustName: "Janus",
  nameHint: "Name is available.",
  operations: "paid" as const,
  plan: "growth" as const,
  selectedLaunchPlan: LAUNCH_PLANS[0],
  canSubmit: true,
  submitting: false,
  onCompanyNameChange: vi.fn(),
  onOperationsChange: vi.fn(),
  onPlanChange: vi.fn(),
  onLaunch: vi.fn(),
};

describe("CompanySetupFlow", () => {
  it("shows an outside-card back affordance when a returning user's COMPANY path is provided", () => {
    render(
      <MemoryRouter>
        <CompanySetupFlow {...baseProps} exitHref="/company/company-1" />
      </MemoryRouter>,
    );

    const exitNav = screen.getByRole("navigation", { name: "Launch exit" });
    const backButton = within(exitNav).getByRole("button", { name: "Back" });

    expect(backButton.closest(".launch-flow-card")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Back" })).toHaveLength(2);
    expect(screen.getByText(/Identity, roles, agents, quests/i)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Launch sequence" })).toBeInTheDocument();
    expect(screen.getByText(/choose whether to add hosted operations now/i)).toBeInTheDocument();
  });

  it("falls back to the COMPANY path when opened without app history", async () => {
    window.history.replaceState({ idx: 0 }, "", "/launch");

    render(
      <MemoryRouter initialEntries={["/launch"]}>
        <Routes>
          <Route
            path="/launch"
            element={<CompanySetupFlow {...baseProps} exitHref="/company/company-1" />}
          />
          <Route path="/company/company-1" element={<div>Returned to COMPANY</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Launch exit" })).getByRole("button"),
    );

    expect(await screen.findByText("Returned to COMPANY")).toBeInTheDocument();
  });

  it("uses the browser's previous app route when one exists", async () => {
    window.history.replaceState({ idx: 1 }, "", "/launch");

    render(
      <MemoryRouter initialEntries={["/company/source", "/launch"]} initialIndex={1}>
        <Routes>
          <Route path="/company/source" element={<div>Previous COMPANY route</div>} />
          <Route
            path="/launch"
            element={<CompanySetupFlow {...baseProps} exitHref="/company/company-1" />}
          />
          <Route path="/company/company-1" element={<div>Fallback COMPANY route</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Launch exit" })).getByRole("button"),
    );

    await waitFor(() => expect(screen.getByText("Previous COMPANY route")).toBeInTheDocument());
    expect(screen.queryByText("Fallback COMPANY route")).not.toBeInTheDocument();
  });

  it("keeps the launch flow closed when no returning COMPANY path is provided", () => {
    render(
      <MemoryRouter>
        <CompanySetupFlow {...baseProps} exitHref={null} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });

  it("shows the Sandbox operations option only when admin sandbox is available", () => {
    const { rerender } = render(
      <MemoryRouter>
        <CompanySetupFlow {...baseProps} exitHref={null} adminSandboxAvailable={false} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("radio", { name: /Admin sandbox/i })).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <CompanySetupFlow
          {...baseProps}
          operations="sandbox"
          exitHref={null}
          adminSandboxAvailable
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("radio", { name: /Admin sandbox/i })).toBeChecked();
    expect(screen.getByText("No Stripe checkout")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Launch admin sandbox/i })).toBeInTheDocument();
  });

  it("describes free launch without promising hosted blueprint runtime", () => {
    render(
      <MemoryRouter>
        <CompanySetupFlow {...baseProps} operations="free" exitHref={null} />
      </MemoryRouter>,
    );

    expect(
      screen.getByText(
        /Creates a free platform COMPANY with a public profile and founding Director/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/activate with hosted operations/i)).toBeInTheDocument();
    expect(screen.getByText("FREE COMPANY")).toBeInTheDocument();
    expect(screen.getByText("Public")).toBeInTheDocument();
    expect(screen.getByText("profile")).toBeInTheDocument();
    expect(screen.getByText("first.")).toBeInTheDocument();
    expect(screen.getAllByText("Operations").length).toBeGreaterThan(1);
    expect(screen.getByText("Available with Standard or Pro")).toBeInTheDocument();
    expect(screen.queryByText("Agents, quests, tools")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create free COMPANY" })).toBeInTheDocument();
  });
});
