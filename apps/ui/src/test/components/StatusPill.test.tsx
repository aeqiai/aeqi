import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusPill } from "@/components/ui";

describe("StatusPill", () => {
  it("renders a neutral status body with a state dot", () => {
    const { container } = render(<StatusPill tone="success">Online</StatusPill>);

    expect(screen.getByText("Online")).toBeInTheDocument();
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
