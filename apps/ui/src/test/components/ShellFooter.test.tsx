import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ShellFooter from "@/components/shell/ShellFooter";

describe("ShellFooter", () => {
  it("renders the centered legal clause, wordmark, and right-aligned version", () => {
    render(
      <MemoryRouter>
        <ShellFooter />
      </MemoryRouter>,
    );

    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    expect(screen.getByText("æqi")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "privacy policy" })).toHaveAttribute(
      "href",
      "https://aeqi.ai/privacy",
    );
    expect(screen.getByRole("link", { name: "terms of service" })).toHaveAttribute(
      "href",
      "https://aeqi.ai/terms",
    );
    expect(screen.getByText("v0.7.0")).toBeInTheDocument();
  });

  it("does not render the status indicator", () => {
    render(
      <MemoryRouter>
        <ShellFooter />
      </MemoryRouter>,
    );
    expect(screen.queryByText("Nominal")).not.toBeInTheDocument();
  });
});
