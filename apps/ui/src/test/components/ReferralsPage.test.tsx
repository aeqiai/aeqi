import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import ReferralsPage from "@/pages/ReferralsPage";

describe("ReferralsPage", () => {
  it("presents a global aeqi referral playbook", () => {
    render(
      <MemoryRouter>
        <ReferralsPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Bring the right operators into aeqi.",
    );
    expect(screen.getByRole("link", { name: /browse templates/i })).toHaveAttribute(
      "href",
      "/templates",
    );
    expect(screen.getByRole("link", { name: /invite someone/i })).toHaveAttribute(
      "href",
      expect.stringContaining("mailto:"),
    );
    expect(screen.getByRole("region", { name: "Referral playbook" })).toBeInTheDocument();
  });
});
