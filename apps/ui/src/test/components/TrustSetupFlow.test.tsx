import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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
  it("shows an exit affordance when a returning user's TRUST path is provided", () => {
    render(
      <MemoryRouter>
        <TrustSetupFlow {...baseProps} exitHref="/trust/trust-1" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Back to TRUST" })).toHaveAttribute(
      "href",
      "/trust/trust-1",
    );
    expect(screen.getByRole("link", { name: "Exit" })).toHaveAttribute("href", "/trust/trust-1");
  });

  it("keeps the launch flow closed when no returning TRUST path is provided", () => {
    render(
      <MemoryRouter>
        <TrustSetupFlow {...baseProps} exitHref={null} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("link", { name: "Back to TRUST" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Exit" })).not.toBeInTheDocument();
  });
});
