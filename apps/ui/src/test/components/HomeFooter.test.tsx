import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import HomeFooter from "@/components/shell/HomeFooter";

describe("HomeFooter", () => {
  it("renders the product, developer, and trust surfaces", () => {
    render(
      <MemoryRouter>
        <HomeFooter />
      </MemoryRouter>,
    );

    expect(
      screen.getByText(
        "AEQI is an operating system for autonomous companies: agents, ideas, events, quests, sessions, executions, and the context that binds them.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Product" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Developers" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Trust" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nominal" })).toHaveAttribute(
      "href",
      "https://status.aeqi.ai",
    );
    expect(screen.getByRole("link", { name: "Source" })).toHaveAttribute(
      "href",
      "https://github.com/aeqiai/aeqi",
    );
  });
});
