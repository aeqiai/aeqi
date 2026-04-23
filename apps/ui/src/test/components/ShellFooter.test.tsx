import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ShellFooter from "@/components/shell/ShellFooter";

describe("ShellFooter", () => {
  it("renders the shared strip with brand, status, links, and meta", () => {
    render(
      <MemoryRouter>
        <ShellFooter />
      </MemoryRouter>,
    );

    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    expect(screen.getByText("aeqi")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nominal" })).toHaveAttribute(
      "href",
      "https://status.aeqi.ai",
    );
    expect(screen.getByRole("link", { name: "Templates" })).toHaveAttribute("href", "/templates");
    expect(screen.getByRole("link", { name: "Agents" })).toHaveAttribute("href", "/agents");
    expect(screen.getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/docs");
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute(
      "href",
      "https://aeqi.ai/privacy",
    );
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute(
      "href",
      "https://aeqi.ai/terms",
    );
    expect(screen.getByText("v0.7.0")).toBeInTheDocument();
  });
});
